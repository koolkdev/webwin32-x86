import type { Reg32 } from "../../../../x86/isa/types.js";
import type { IrStorageExpr, IrValueExpr } from "../../../../x86/ir/expressions.js";
import type {
  IrProgram,
  StorageRef
} from "../../../../x86/ir/types.js";
import type { WasmLocalScratchAllocator } from "../../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { wasmValueType } from "../../encoder/types.js";
import { wasmIrLocalAluFlagsStorage } from "../../lowering/alu-flags.js";
import { emitWasmIrExitFromI32Stack, type WasmIrExitTarget } from "../../lowering/exit.js";
import { emitWasmIrLoadGuestU32, emitWasmIrLoadGuestU32FromStack, emitWasmIrStoreGuestU32 } from "../../lowering/memory.js";
import { wasmIrLocalReg32Storage, type WasmIrReg32Storage } from "../../lowering/registers.js";
import {
  emitCompleteInstruction,
  emitCompleteInstructionWithTarget
} from "./state-cache.js";
import {
  emitLoadReg32ByIndex,
  emitModRmRmIndex,
  emitOpcodeRegIndex,
  emitStoreReg32ByIndex
} from "../dispatch/register-dispatch.js";
import type { InterpreterStateCache } from "./state-cache.js";
import { emitIfModRmMemory, emitIfModRmRegister, emitModRmIsRegister, emitModRmRegIndex } from "../decode/modrm-bits.js";
import { lowerIrToWasm, type WasmIrEmitHelpers } from "../../lowering/lower.js";
import { emitSetFlags } from "../../lowering/flags.js";
import { emitAluFlagsCondition, emitFlagProducerCondition } from "../../lowering/conditions.js";
import { ExitReason } from "../../exit.js";

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

export type InterpreterIrContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: InterpreterStateCache;
  exit: WasmIrExitTarget;
  eipLocal: number;
  instructionLength: InterpreterInstructionLength;
  operands: readonly InterpreterOperandBinding[];
  instructionDoneLabelDepth: number;
}>;

export function lowerIrWithInterpreterContext(program: IrProgram, context: InterpreterIrContext): void {
  const aluFlags = wasmIrLocalAluFlagsStorage(context.body, context.state.aluFlagsLocal);
  const regs = wasmIrLocalReg32Storage(context.body, context.state.regs);

  lowerIrToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    expression: { canInlineGet32: (source) => canInlineGet32(context, source) },
    emitGet32: (source, helpers) => emitGet32(context, regs, source, helpers),
    emitSet32: (target, value, helpers) => emitSet32(context, regs, target, value, helpers),
    emitAddress32: (source) => emitAddress32(context, source),
    emitSetFlags: (descriptor, helpers) =>
      emitSetFlags(context.body, aluFlags, descriptor, helpers),
    emitMaterializeFlags: () => {},
    emitBoundaryFlags: () => {},
    emitAluFlagsCondition: (cc) => emitAluFlagsCondition(context.body, aluFlags, cc),
    emitFlagProducerCondition: (condition, helpers) => emitFlagProducerCondition(context.body, condition, helpers),
    emitNext: () => emitNext(context),
    emitNextEip: () => emitNextEip(context),
    emitJump: (target, helpers) => emitJump(context, target, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitConditionalJump(context, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitHostTrap(context, vector, helpers)
  });
}

function emitGet32(
  context: InterpreterIrContext,
  regs: WasmIrReg32Storage,
  source: IrStorageExpr,
  helpers: WasmIrEmitHelpers
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

function canInlineGet32(context: InterpreterIrContext, source: StorageRef): boolean {
  switch (source.kind) {
    case "reg":
      return true;
    case "mem":
      return false;
    case "operand": {
      const binding = operandBinding(context, source.index);

      return (
        binding.kind === "opcode.reg32" ||
        binding.kind === "modrm.reg32" ||
        binding.kind === "implicit.reg32" ||
        binding.kind === "imm32" ||
        binding.kind === "relTarget32"
      );
    }
  }
}

function emitSet32(
  context: InterpreterIrContext,
  regs: WasmIrReg32Storage,
  target: IrStorageExpr,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
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

function emitAddress32(context: InterpreterIrContext, source: IrStorageExpr): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address32 source for Wasm interpreter: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "mem32") {
    throw new Error(`address32 operand is not memory: ${binding.kind}`);
  }

  context.body.localGet(binding.addressLocal);
}

function emitGetOperand32(context: InterpreterIrContext, regs: WasmIrReg32Storage, index: number): void {
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
      emitWasmIrLoadGuestU32(context, binding.addressLocal);
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
  context: InterpreterIrContext,
  regs: WasmIrReg32Storage,
  index: number,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
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

function emitNext(context: InterpreterIrContext): void {
  if (typeof context.instructionLength === "number") {
    emitCompleteInstruction(context.body, context.state, context.instructionLength);
  } else {
    emitCompleteInstructionWithTarget(context.body, context.state, () => emitNextEip(context));
  }
  emitContinue(context);
}

function emitNextEip(context: InterpreterIrContext): void {
  context.body.localGet(context.eipLocal);

  if (typeof context.instructionLength === "number") {
    context.body.i32Const(context.instructionLength);
  } else {
    context.body.localGet(context.instructionLength.local);
  }

  context.body.i32Add();
}

function emitJump(context: InterpreterIrContext, target: IrValueExpr, helpers: WasmIrEmitHelpers): void {
  emitCompleteInstructionWithTarget(context.body, context.state, () => helpers.emitValue(target));
  emitContinue(context);
}

function emitConditionalJump(
  context: InterpreterIrContext,
  condition: IrValueExpr,
  taken: IrValueExpr,
  notTaken: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  helpers.emitValue(condition);
  context.body.ifBlock();
  emitCompleteInstructionWithTarget(context.body, context.state, () => helpers.emitValue(taken));
  emitContinue(context, 1);
  context.body.endBlock();
  emitCompleteInstructionWithTarget(context.body, context.state, () => helpers.emitValue(notTaken));
  emitContinue(context);
}

function emitHostTrap(context: InterpreterIrContext, vector: IrValueExpr, helpers: WasmIrEmitHelpers): void {
  if (typeof context.instructionLength === "number") {
    emitCompleteInstruction(context.body, context.state, context.instructionLength);
  } else {
    emitCompleteInstructionWithTarget(context.body, context.state, () => emitNextEip(context));
  }

  helpers.emitValue(vector);
  emitWasmIrExitFromI32Stack(context.body, context.exit, ExitReason.HOST_TRAP);
}

function emitContinue(context: InterpreterIrContext, extraDepth = 0): void {
  context.body.br(context.instructionDoneLabelDepth + extraDepth);
}

function emitGetRm32(
  context: InterpreterIrContext,
  binding: Extract<InterpreterOperandBinding, { kind: "rm32" }>
): void {
  emitModRmIsRegister(context.body, binding.modRmLocal);
  context.body.ifBlock(undefined, wasmValueType.i32);
  emitLoadReg32ByIndex(context.body, context.state.regs, () => {
    emitModRmRmIndex(context.body, binding.modRmLocal);
  });
  context.body.elseBlock();
  emitWasmIrLoadGuestU32(context, binding.addressLocal, 2);
  context.body.endBlock();
}

function emitLoadGuestU32FromStack(context: InterpreterIrContext): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitWasmIrLoadGuestU32FromStack(context, addressLocal);
  } finally {
    context.scratch.freeLocal(addressLocal);
  }
}

function emitSetRm32(
  context: InterpreterIrContext,
  binding: Extract<InterpreterOperandBinding, { kind: "rm32" }>,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(value);
    context.body.localSet(valueLocal);
    emitIfModRmRegister(context.body, binding.modRmLocal, () => {
      emitStoreReg32ByIndex(context.body, context.state.regs, () => {
        emitModRmRmIndex(context.body, binding.modRmLocal);
      }, valueLocal);
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
    context.scratch.freeLocal(valueLocal);
  }
}

function emitStoreMem32(
  context: InterpreterIrContext,
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
    emitWasmIrStoreGuestU32(context, addressLocal, valueLocal, faultExtraDepth);
  } finally {
    context.scratch.freeLocal(valueLocal);
    context.scratch.freeLocal(addressLocal);
  }
}

function operandBinding(context: InterpreterIrContext, index: number): InterpreterOperandBinding {
  const binding = context.operands[index];

  if (binding === undefined) {
    throw new Error(`missing interpreter operand binding: ${index}`);
  }

  return binding;
}

function emitLoadDynamicReg32(context: InterpreterIrContext, emitIndex: () => void): void {
  emitLoadReg32ByIndex(context.body, context.state.regs, emitIndex);
}

function emitStoreDynamicReg32(
  context: InterpreterIrContext,
  emitIndex: () => void,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(value);
    context.body.localSet(valueLocal);
    emitStoreReg32ByIndex(context.body, context.state.regs, emitIndex, valueLocal);
  } finally {
    context.scratch.freeLocal(valueLocal);
  }
}
