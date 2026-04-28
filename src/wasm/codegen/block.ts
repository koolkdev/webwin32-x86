import { instructionEnd } from "../../arch/x86/instruction/address.js";
import type { DecodedBlock, BlockTerminator } from "../../arch/x86/block-decoder/decode-block.js";
import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitAlu } from "./alu.js";
import { emitJcc, emitJmp } from "./branch.js";
import { unsupportedWasmCodegen } from "./errors.js";
import { emitExitResult } from "./exit.js";
import { emitMov } from "./mov.js";

export class WasmBlockCompiler {
  encodeInstructions(instructions: readonly DecodedInstruction[]): Uint8Array<ArrayBuffer> {
    const lastInstruction = instructions[instructions.length - 1];

    if (lastInstruction === undefined) {
      throw new Error("cannot compile an empty block");
    }

    return encodeWasmBlock(instructions, { kind: "fallthrough", nextEip: instructionEnd(lastInstruction) });
  }

  encodeDecodedBlock(block: DecodedBlock): Uint8Array<ArrayBuffer> {
    return encodeWasmBlock(block.instructions, block.terminator);
  }

  async compileInstructions(instructions: readonly DecodedInstruction[]): Promise<WebAssembly.Module> {
    return WebAssembly.compile(this.encodeInstructions(instructions));
  }

  async compileDecodedBlock(block: DecodedBlock): Promise<WebAssembly.Module> {
    return WebAssembly.compile(this.encodeDecodedBlock(block));
  }
}

function encodeWasmBlock(
  instructions: readonly DecodedInstruction[],
  terminator: BlockTerminator
): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const stateMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.stateMemoryName, { minPages: 1 });
  const guestMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.guestMemoryName, { minPages: 1 });

  if (stateMemoryIndex !== wasmMemoryIndex.state || guestMemoryIndex !== wasmMemoryIndex.guest) {
    throw new Error("unexpected Wasm memory import order");
  }

  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder(1);

  for (const instruction of instructions) {
    emitInstruction(body, instruction);
  }

  emitTerminator(body, terminator);
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

  return module.encode();
}

function emitInstruction(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  switch (instruction.mnemonic) {
    case "mov":
      emitMov(body, instruction);
      return;
    case "add":
    case "sub":
    case "xor":
    case "cmp":
    case "test":
      emitAlu(body, instruction);
      return;
    case "jmp":
      emitJmp(body, instruction);
      return;
    case "jcc":
      emitJcc(body, instruction);
      return;
    default:
      unsupportedWasmCodegen(`unsupported instruction for Wasm codegen: ${instruction.mnemonic}`);
  }
}

function emitTerminator(body: WasmFunctionBodyEncoder, terminator: BlockTerminator): void {
  switch (terminator.kind) {
    case "fallthrough":
      emitExitResult(body, ExitReason.FALLTHROUGH, terminator.nextEip);
      return;
    case "host-call":
      emitExitResult(body, ExitReason.HOST_CALL, terminator.hostCallId);
      return;
    case "jump":
    case "conditional-branch":
      return;
    default:
      unsupportedWasmCodegen(`unsupported block terminator for Wasm codegen: ${terminator.kind}`);
  }
}
