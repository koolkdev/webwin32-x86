import { instructionEnd } from "../../arch/x86/instruction/address.js";
import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitAlu } from "./alu.js";
import { emitExitResult } from "./exit.js";
import { emitMov } from "./mov.js";

export function compileBlock(instructions: readonly DecodedInstruction[]): Uint8Array<ArrayBuffer> {
  const lastInstruction = instructions[instructions.length - 1];

  if (lastInstruction === undefined) {
    throw new Error("cannot compile an empty block");
  }

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

  emitExitResult(body, ExitReason.FALLTHROUGH, instructionEnd(lastInstruction)).end();

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
    default:
      throw new Error(`unsupported instruction for Wasm codegen: ${instruction.mnemonic}`);
  }
}
