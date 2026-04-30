import type {
  SirProgram,
  StorageRef,
  ValueRef
} from "../../arch/x86/sir/types.js";
import { wasmMemoryIndex } from "../abi.js";
import { emitExitResult } from "../codegen/exit.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import {
  emitCompleteInstruction,
  emitLoadReg32,
  emitOpcodeRegAddress,
  emitStoreReg32FromStack
} from "../interpreter/state.js";
import { lowerSirToWasm, type WasmSirEmitHelpers } from "./lower.js";

export type InterpreterOperandBinding =
  | Readonly<{ kind: "opcode.reg32"; opcodeLocal: number }>
  | Readonly<{ kind: "imm32"; local: number }>;

export type InterpreterSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  eipLocal: number;
  instructionLength: number;
  operands: readonly InterpreterOperandBinding[];
}>;

export function lowerSirWithInterpreterContext(program: SirProgram, context: InterpreterSirContext): void {
  lowerSirToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    emitGet32: (source) => emitGet32(context, source),
    emitSet32: (target, value, helpers) => emitSet32(context, target, value, helpers),
    emitNext: () => emitNext(context),
    emitNextEip: () => emitNextEip(context)
  });
}

function emitGet32(context: InterpreterSirContext, source: StorageRef): void {
  switch (source.kind) {
    case "operand":
      emitGetOperand32(context, source.index);
      return;
    case "reg":
      emitLoadReg32(context.body, source.reg);
      return;
    default:
      throw new Error(`unsupported get32 source for Wasm interpreter: ${source.kind}`);
  }
}

function emitSet32(
  context: InterpreterSirContext,
  target: StorageRef,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  switch (target.kind) {
    case "operand":
      emitSetOperand32(context, target.index, value, helpers);
      return;
    case "reg":
      context.body.i32Const(0);
      helpers.emitValue(value);
      emitStoreReg32FromStack(context.body, target.reg);
      return;
    default:
      throw new Error(`unsupported set32 target for Wasm interpreter: ${target.kind}`);
  }
}

function emitGetOperand32(context: InterpreterSirContext, index: number): void {
  const binding = operandBinding(context, index);

  switch (binding.kind) {
    case "opcode.reg32":
      emitOpcodeRegAddress(context.body, binding.opcodeLocal);
      context.body.i32Load({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "imm32":
      context.body.localGet(binding.local);
      return;
  }
}

function emitSetOperand32(
  context: InterpreterSirContext,
  index: number,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  const binding = operandBinding(context, index);

  switch (binding.kind) {
    case "opcode.reg32":
      emitOpcodeRegAddress(context.body, binding.opcodeLocal);
      helpers.emitValue(value);
      context.body.i32Store({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "imm32":
      throw new Error("cannot set imm32 operand");
  }
}

function emitNext(context: InterpreterSirContext): void {
  emitCompleteInstruction(context.body, context.eipLocal, context.instructionLength);
  emitExitResult(context.body, ExitReason.INSTRUCTION_LIMIT, 0).returnFromFunction();
}

function emitNextEip(context: InterpreterSirContext): void {
  context.body.localGet(context.eipLocal).i32Const(context.instructionLength).i32Add();
}

function operandBinding(context: InterpreterSirContext, index: number): InterpreterOperandBinding {
  const binding = context.operands[index];

  if (binding === undefined) {
    throw new Error(`missing interpreter operand binding: ${index}`);
  }

  return binding;
}
