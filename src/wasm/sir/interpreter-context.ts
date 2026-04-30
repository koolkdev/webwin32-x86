import type { Reg32 } from "../../arch/x86/instruction/types.js";
import type {
  SirProgram,
  StorageRef,
  ValueRef
} from "../../arch/x86/sir/types.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { wasmSirLocalEflagsStorage } from "./eflags.js";
import { emitWasmSirExit, type WasmSirExitTarget } from "./exit.js";
import { emitWasmSirLoadGuestU32, emitWasmSirStoreGuestU32 } from "./memory.js";
import { wasmSirLocalReg32Storage, type WasmSirReg32Storage } from "./registers.js";
import {
  emitCompleteInstruction,
  emitCompleteInstructionWithTarget,
  emitCopyReg32FromIndexLocal,
  emitModRmRmIndex,
  emitOpcodeRegIndex,
  emitStoreReg32ByIndexLocal
} from "../interpreter/state-cache.js";
import type { InterpreterStateCache } from "../interpreter/state-cache.js";
import { emitIfModRmMemory, emitIfModRmRegister, emitModRmRegIndex } from "../interpreter/modrm-bits.js";
import { lowerSirToWasm, type WasmSirEmitHelpers } from "./lower.js";
import { emitSetFlags } from "./flags.js";
import { emitCondition } from "./conditions.js";
import { ExitReason } from "../exit.js";

export type InterpreterOperandBinding =
  | Readonly<{ kind: "opcode.reg32"; opcodeLocal: number }>
  | Readonly<{ kind: "modrm.reg32"; modRmLocal: number }>
  | Readonly<{ kind: "rm32"; modRmLocal: number; addressLocal: number }>
  | Readonly<{ kind: "mem32"; addressLocal: number }>
  | Readonly<{ kind: "implicit.reg32"; reg: Reg32 }>
  | Readonly<{ kind: "imm32"; local: number }>
  | Readonly<{ kind: "relTarget32"; local: number }>;

export type InterpreterInstructionLength =
  | number
  | Readonly<{ kind: "local"; local: number }>;

export type InterpreterSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: InterpreterStateCache;
  exit: WasmSirExitTarget;
  eipLocal: number;
  instructionLength: InterpreterInstructionLength;
  operands: readonly InterpreterOperandBinding[];
  instructionDoneLabelDepth: number;
}>;

export function lowerSirWithInterpreterContext(program: SirProgram, context: InterpreterSirContext): void {
  const eflags = wasmSirLocalEflagsStorage(context.body, context.state.eflagsLocal);
  const regs = wasmSirLocalReg32Storage(context.body, context.state.regs);

  lowerSirToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    emitGet32: (source, helpers) => emitGet32(context, regs, source, helpers),
    emitSet32: (target, value, helpers) => emitSet32(context, regs, target, value, helpers),
    emitAddress32: (source) => emitAddress32(context, source),
    emitSetFlags: (producer, inputs, helpers) =>
      emitSetFlags(context.body, context.scratch, eflags, producer, inputs, helpers),
    emitCondition: (cc) => emitCondition(context.body, eflags, cc),
    emitNext: () => emitNext(context),
    emitNextEip: () => emitNextEip(context),
    emitJump: (target, helpers) => emitJump(context, target, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitConditionalJump(context, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitHostTrap(context, vector, helpers)
  });
}

function emitGet32(
  context: InterpreterSirContext,
  regs: WasmSirReg32Storage,
  source: StorageRef,
  helpers: WasmSirEmitHelpers
): void {
  switch (source.kind) {
    case "operand":
      emitGetOperand32(context, regs, source.index);
      return;
    case "reg":
      regs.emitGet(source.reg);
      return;
    case "mem":
      helpers.emitValue(source.address);
      emitLoadGuestU32FromStack(context);
      return;
  }
}

function emitSet32(
  context: InterpreterSirContext,
  regs: WasmSirReg32Storage,
  target: StorageRef,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  switch (target.kind) {
    case "operand":
      emitSetOperand32(context, regs, target.index, value, helpers);
      return;
    case "reg":
      regs.emitSet(target.reg, () => helpers.emitValue(value));
      return;
    case "mem":
      emitStoreMem32(context, () => helpers.emitValue(target.address), () => helpers.emitValue(value));
      return;
  }
}

function emitAddress32(context: InterpreterSirContext, source: StorageRef): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address32 source for Wasm interpreter: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "mem32") {
    throw new Error(`address32 operand is not memory: ${binding.kind}`);
  }

  context.body.localGet(binding.addressLocal);
}

function emitGetOperand32(context: InterpreterSirContext, regs: WasmSirReg32Storage, index: number): void {
  const binding = operandBinding(context, index);

  switch (binding.kind) {
    case "opcode.reg32":
      emitLoadDynamicReg32(context, () => emitOpcodeRegIndex(context.body, binding.opcodeLocal));
      return;
    case "modrm.reg32":
      emitLoadDynamicReg32(context, () => emitModRmRegIndex(context.body, binding.modRmLocal));
      return;
    case "rm32":
      emitGetRm32(context, binding);
      return;
    case "mem32":
      emitWasmSirLoadGuestU32(context, binding.addressLocal);
      return;
    case "implicit.reg32":
      regs.emitGet(binding.reg);
      return;
    case "imm32":
    case "relTarget32":
      context.body.localGet(binding.local);
      return;
  }
}

function emitSetOperand32(
  context: InterpreterSirContext,
  regs: WasmSirReg32Storage,
  index: number,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  const binding = operandBinding(context, index);

  switch (binding.kind) {
    case "opcode.reg32":
      emitStoreDynamicReg32(context, () => emitOpcodeRegIndex(context.body, binding.opcodeLocal), value, helpers);
      return;
    case "modrm.reg32":
      emitStoreDynamicReg32(context, () => emitModRmRegIndex(context.body, binding.modRmLocal), value, helpers);
      return;
    case "rm32":
      emitSetRm32(context, binding, value, helpers);
      return;
    case "mem32":
      emitStoreMem32(context, () => context.body.localGet(binding.addressLocal), () => helpers.emitValue(value));
      return;
    case "implicit.reg32":
      regs.emitSet(binding.reg, () => helpers.emitValue(value));
      return;
    case "imm32":
    case "relTarget32":
      throw new Error(`cannot set ${binding.kind} operand`);
  }
}

function emitNext(context: InterpreterSirContext): void {
  if (typeof context.instructionLength === "number") {
    emitCompleteInstruction(context.body, context.state, context.instructionLength);
  } else {
    emitCompleteInstructionWithTarget(context.body, context.state, () => emitNextEip(context));
  }
  emitContinue(context);
}

function emitNextEip(context: InterpreterSirContext): void {
  context.body.localGet(context.eipLocal);

  if (typeof context.instructionLength === "number") {
    context.body.i32Const(context.instructionLength);
  } else {
    context.body.localGet(context.instructionLength.local);
  }

  context.body.i32Add();
}

function emitJump(context: InterpreterSirContext, target: ValueRef, helpers: WasmSirEmitHelpers): void {
  emitCompleteInstructionWithTarget(context.body, context.state, () => helpers.emitValue(target));
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
  emitCompleteInstructionWithTarget(context.body, context.state, () => helpers.emitValue(taken));
  emitContinue(context, 1);
  context.body.endBlock();
  emitCompleteInstructionWithTarget(context.body, context.state, () => helpers.emitValue(notTaken));
  emitContinue(context);
}

function emitHostTrap(context: InterpreterSirContext, vector: ValueRef, helpers: WasmSirEmitHelpers): void {
  if (typeof context.instructionLength === "number") {
    emitCompleteInstruction(context.body, context.state, context.instructionLength);
  } else {
    emitCompleteInstructionWithTarget(context.body, context.state, () => emitNextEip(context));
  }

  emitWasmSirExit(context.body, context.exit, ExitReason.HOST_TRAP, () => helpers.emitValue(vector));
}

function emitContinue(context: InterpreterSirContext, extraDepth = 0): void {
  context.body.br(context.instructionDoneLabelDepth + extraDepth);
}

function emitGetRm32(
  context: InterpreterSirContext,
  binding: Extract<InterpreterOperandBinding, { kind: "rm32" }>
): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);
  const indexLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitIfModRmRegister(context.body, binding.modRmLocal, () => {
      emitModRmRmIndex(context.body, binding.modRmLocal);
      context.body.localSet(indexLocal);
      emitCopyReg32FromIndexLocal(context.body, context.state, indexLocal, valueLocal);
    });
    emitIfModRmMemory(context.body, binding.modRmLocal, () => {
      emitWasmSirLoadGuestU32(context, binding.addressLocal, 2);
      context.body.localSet(valueLocal);
    });
    context.body.localGet(valueLocal);
  } finally {
    context.scratch.freeLocal(indexLocal);
    context.scratch.freeLocal(valueLocal);
  }
}

function emitSetRm32(
  context: InterpreterSirContext,
  binding: Extract<InterpreterOperandBinding, { kind: "rm32" }>,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);
  const indexLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(value);
    context.body.localSet(valueLocal);
    emitIfModRmRegister(context.body, binding.modRmLocal, () => {
      emitModRmRmIndex(context.body, binding.modRmLocal);
      context.body.localSet(indexLocal);
      emitStoreReg32ByIndexLocal(context.body, context.state, indexLocal, valueLocal);
    });
    emitIfModRmMemory(context.body, binding.modRmLocal, () => {
      emitStoreMem32(
        context,
        () => context.body.localGet(binding.addressLocal),
        () => context.body.localGet(valueLocal),
        2
      );
    });
  } finally {
    context.scratch.freeLocal(indexLocal);
    context.scratch.freeLocal(valueLocal);
  }
}

function emitLoadGuestU32FromStack(context: InterpreterSirContext): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    context.body.localSet(addressLocal);
    emitWasmSirLoadGuestU32(context, addressLocal);
  } finally {
    context.scratch.freeLocal(addressLocal);
  }
}

function emitStoreMem32(
  context: InterpreterSirContext,
  emitAddress: () => void,
  emitValue: () => void,
  faultExtraDepth = 1
): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitAddress();
    context.body.localSet(addressLocal);
    emitValue();
    context.body.localSet(valueLocal);
    emitWasmSirStoreGuestU32(context, addressLocal, valueLocal, faultExtraDepth);
  } finally {
    context.scratch.freeLocal(valueLocal);
    context.scratch.freeLocal(addressLocal);
  }
}

function operandBinding(context: InterpreterSirContext, index: number): InterpreterOperandBinding {
  const binding = context.operands[index];

  if (binding === undefined) {
    throw new Error(`missing interpreter operand binding: ${index}`);
  }

  return binding;
}

function emitLoadDynamicReg32(context: InterpreterSirContext, emitIndex: () => void): void {
  const indexLocal = context.scratch.allocLocal(wasmValueType.i32);
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitIndex();
    context.body.localSet(indexLocal);
    emitCopyReg32FromIndexLocal(context.body, context.state, indexLocal, valueLocal);
    context.body.localGet(valueLocal);
  } finally {
    context.scratch.freeLocal(valueLocal);
    context.scratch.freeLocal(indexLocal);
  }
}

function emitStoreDynamicReg32(
  context: InterpreterSirContext,
  emitIndex: () => void,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  const indexLocal = context.scratch.allocLocal(wasmValueType.i32);
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitIndex();
    context.body.localSet(indexLocal);
    helpers.emitValue(value);
    context.body.localSet(valueLocal);
    emitStoreReg32ByIndexLocal(context.body, context.state, indexLocal, valueLocal);
  } finally {
    context.scratch.freeLocal(valueLocal);
    context.scratch.freeLocal(indexLocal);
  }
}
