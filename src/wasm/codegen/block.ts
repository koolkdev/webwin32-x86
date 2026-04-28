import { instructionEnd } from "../../arch/x86/instruction/address.js";
import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { stateOffset, reg32StateOffset, wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitExitResult } from "./exit.js";

const u32Align = 2;

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
  const body = new WasmFunctionBodyEncoder();

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
      emitMovR32Imm32(body, instruction);
      return;
    default:
      throw new Error(`unsupported instruction for Wasm codegen: ${instruction.mnemonic}`);
  }
}

function emitMovR32Imm32(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const destination = instruction.operands[0];
  const source = instruction.operands[1];

  if (destination?.kind !== "reg32" || source?.kind !== "imm32") {
    throw new Error("unsupported mov form for Wasm codegen");
  }

  emitStoreStateU32(body, reg32StateOffset(destination.reg), source.value);
  emitStoreStateU32(body, stateOffset.eip, instructionEnd(instruction));
  emitIncrementInstructionCount(body);
}

function emitStoreStateU32(body: WasmFunctionBodyEncoder, offset: number, value: number): void {
  body
    .localGet(0)
    .i32Const(i32(value))
    .i32Store({
      align: u32Align,
      memoryIndex: wasmMemoryIndex.state,
      offset
    });
}

function emitIncrementInstructionCount(body: WasmFunctionBodyEncoder): void {
  body
    .localGet(0)
    .localGet(0)
    .i32Load({
      align: u32Align,
      memoryIndex: wasmMemoryIndex.state,
      offset: stateOffset.instructionCount
    })
    .i32Const(1)
    .i32Add()
    .i32Store({
      align: u32Align,
      memoryIndex: wasmMemoryIndex.state,
      offset: stateOffset.instructionCount
    });
}
