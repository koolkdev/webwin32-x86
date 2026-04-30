import type { Reg32 } from "../../arch/x86/instruction/types.js";
import type {
  SirProgram,
  StorageRef,
  ValueRef
} from "../../arch/x86/sir/types.js";
import { wasmMemoryIndex } from "../abi.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import {
  emitCompleteInstruction,
  emitCompleteInstructionWithTarget,
  emitLoadReg32,
  emitModRmRegAddress,
  emitModRmRmAddress,
  emitOpcodeRegAddress,
  emitStoreReg32
} from "../interpreter/state.js";
import { lowerSirToWasm, type WasmSirEmitHelpers } from "./lower.js";
import { emitSetFlags } from "./flags.js";
import { emitCondition } from "./conditions.js";

export type InterpreterOperandBinding =
  | Readonly<{ kind: "opcode.reg32"; opcodeLocal: number }>
  | Readonly<{ kind: "modrm.reg32"; modRmLocal: number }>
  | Readonly<{ kind: "modrm.rm32"; modRmLocal: number }>
  | Readonly<{ kind: "implicit.reg32"; reg: Reg32 }>
  | Readonly<{ kind: "imm32"; local: number }>
  | Readonly<{ kind: "relTarget32"; local: number }>;

export type InterpreterSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  eipLocal: number;
  instructionLength: number;
  operands: readonly InterpreterOperandBinding[];
  instructionDoneLabelDepth: number;
}>;

export function lowerSirWithInterpreterContext(program: SirProgram, context: InterpreterSirContext): void {
  lowerSirToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    emitGet32: (source) => emitGet32(context, source),
    emitSet32: (target, value, helpers) => emitSet32(context, target, value, helpers),
    emitSetFlags: (producer, inputs, helpers) =>
      emitSetFlags(context.body, context.scratch, producer, inputs, helpers),
    emitCondition: (cc) => emitCondition(context.body, cc),
    emitNext: () => emitNext(context),
    emitNextEip: () => emitNextEip(context),
    emitJump: (target, helpers) => emitJump(context, target, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitConditionalJump(context, condition, taken, notTaken, helpers)
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
      emitStoreReg32(context.body, target.reg, () => helpers.emitValue(value));
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
    case "modrm.reg32":
      emitModRmRegAddress(context.body, binding.modRmLocal);
      context.body.i32Load({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "modrm.rm32":
      emitModRmRmAddress(context.body, binding.modRmLocal);
      context.body.i32Load({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "implicit.reg32":
      emitLoadReg32(context.body, binding.reg);
      return;
    case "imm32":
    case "relTarget32":
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
    case "modrm.reg32":
      emitModRmRegAddress(context.body, binding.modRmLocal);
      helpers.emitValue(value);
      context.body.i32Store({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "modrm.rm32":
      emitModRmRmAddress(context.body, binding.modRmLocal);
      helpers.emitValue(value);
      context.body.i32Store({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "implicit.reg32":
      emitStoreReg32(context.body, binding.reg, () => helpers.emitValue(value));
      return;
    case "imm32":
    case "relTarget32":
      throw new Error(`cannot set ${binding.kind} operand`);
  }
}

function emitNext(context: InterpreterSirContext): void {
  emitCompleteInstruction(context.body, context.eipLocal, context.instructionLength);
  emitContinue(context);
}

function emitNextEip(context: InterpreterSirContext): void {
  context.body.localGet(context.eipLocal).i32Const(context.instructionLength).i32Add();
}

function emitJump(context: InterpreterSirContext, target: ValueRef, helpers: WasmSirEmitHelpers): void {
  emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => helpers.emitValue(target));
  emitContinue(context);
}

function emitConditionalJump(
  context: InterpreterSirContext,
  condition: ValueRef,
  taken: ValueRef,
  notTaken: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  helpers.emitValue(condition);
  context.body.ifBlock();
  emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => helpers.emitValue(taken));
  emitContinue(context, 1);
  context.body.endBlock();
  emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => helpers.emitValue(notTaken));
  emitContinue(context);
}

function emitContinue(context: InterpreterSirContext, extraDepth = 0): void {
  context.body.br(context.instructionDoneLabelDepth + extraDepth);
}

function operandBinding(context: InterpreterSirContext, index: number): InterpreterOperandBinding {
  const binding = context.operands[index];

  if (binding === undefined) {
    throw new Error(`missing interpreter operand binding: ${index}`);
  }

  return binding;
}
