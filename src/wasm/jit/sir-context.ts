import type { Mem32Operand, Reg32 } from "../../arch/x86/instruction/types.js";
import type { IsaDecodedInstruction, IsaOperandBinding } from "../../arch/x86/isa/decoder/types.js";
import type { SirProgram, StorageRef } from "../../arch/x86/sir/types.js";
import type { SirStorageExpr, SirValueExpr } from "../../arch/x86/sir/expressions.js";
import { reg32 } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitCondition } from "../sir/conditions.js";
import { wasmSirLocalEflagsStorage } from "../sir/eflags.js";
import { emitWasmSirExit, type WasmSirExitTarget } from "../sir/exit.js";
import { emitSetFlags } from "../sir/flags.js";
import { lowerSirToWasm, type WasmSirEmitHelpers } from "../sir/lower.js";
import { emitWasmSirLoadGuestU32FromStack, emitWasmSirStoreGuestU32 } from "../sir/memory.js";
import { wasmSirLocalReg32Storage, type WasmSirReg32Storage } from "../sir/registers.js";
import { emitLoadStateU32, emitStoreStateU32 } from "../sir/state.js";

export type JitOperandBinding =
  | Readonly<{ kind: "static.reg32"; reg: Reg32 }>
  | Readonly<{ kind: "static.mem32"; ea: Mem32Operand }>
  | Readonly<{ kind: "static.imm32"; value: number }>
  | Readonly<{ kind: "static.relTarget"; target: number }>;

export type JitSirState = Readonly<{
  regs: Readonly<Record<Reg32, number>>;
  eipLocal: number;
  eflagsLocal: number;
  instructionCountLocal: number;
}>;

export type JitSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitSirState;
  exit: WasmSirExitTarget;
  operands: readonly JitOperandBinding[];
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export function createJitSirState(body: WasmFunctionBodyEncoder): JitSirState {
  const regs = Object.fromEntries(
    reg32.map((reg) => [reg, body.addLocal(wasmValueType.i32)])
  ) as Record<Reg32, number>;

  return {
    regs,
    eipLocal: body.addLocal(wasmValueType.i32),
    eflagsLocal: body.addLocal(wasmValueType.i32),
    instructionCountLocal: body.addLocal(wasmValueType.i32)
  };
}

export function emitLoadJitSirState(body: WasmFunctionBodyEncoder, state: JitSirState): void {
  for (const reg of reg32) {
    emitLoadStateU32(body, stateOffset[reg]);
    body.localSet(state.regs[reg]);
  }

  emitLoadStateU32(body, stateOffset.eip);
  body.localSet(state.eipLocal);
  emitLoadStateU32(body, stateOffset.eflags);
  body.localSet(state.eflagsLocal);
  emitLoadStateU32(body, stateOffset.instructionCount);
  body.localSet(state.instructionCountLocal);
}

export function emitFlushJitSirState(body: WasmFunctionBodyEncoder, state: JitSirState): void {
  for (const reg of reg32) {
    emitStoreStateU32(body, stateOffset[reg], () => {
      body.localGet(state.regs[reg]);
    });
  }

  emitStoreStateU32(body, stateOffset.eip, () => {
    body.localGet(state.eipLocal);
  });
  emitStoreStateU32(body, stateOffset.eflags, () => {
    body.localGet(state.eflagsLocal);
  });
  emitStoreStateU32(body, stateOffset.instructionCount, () => {
    body.localGet(state.instructionCountLocal);
  });
}

export function lowerSirWithJitContext(program: SirProgram, context: JitSirContext): void {
  const eflags = wasmSirLocalEflagsStorage(context.body, context.state.eflagsLocal);
  const regs = wasmSirLocalReg32Storage(context.body, context.state.regs);

  lowerSirToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    expression: { canInlineGet32: (source) => canInlineGet32(context, source) },
    emitGet32: (source, helpers) => emitGet32(context, regs, source, helpers),
    emitSet32: (target, value, helpers) => emitSet32(context, regs, target, value, helpers),
    emitAddress32: (source) => emitAddress32(context, regs, source),
    emitSetFlags: (producer, inputs, helpers) =>
      emitSetFlags(context.body, context.scratch, eflags, producer, inputs, helpers),
    emitCondition: (cc) => emitCondition(context.body, eflags, cc),
    emitNext: () => emitNext(context),
    emitNextEip: () => emitNextEip(context),
    emitJump: (target, helpers) => emitControlExit(context, target, ExitReason.JUMP, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitConditionalJump(context, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitHostTrap(context, vector, helpers)
  });
}

export function jitBindingsFromIsaInstruction(instruction: IsaDecodedInstruction): readonly JitOperandBinding[] {
  return instruction.operands.map(jitBindingFromIsaOperand);
}

function jitBindingFromIsaOperand(operand: IsaOperandBinding): JitOperandBinding {
  switch (operand.kind) {
    case "reg32":
      return { kind: "static.reg32", reg: operand.reg };
    case "mem32":
      return { kind: "static.mem32", ea: operand };
    case "imm32":
      return { kind: "static.imm32", value: operand.value };
    case "relTarget":
      return { kind: "static.relTarget", target: operand.target };
  }
}

function canInlineGet32(context: JitSirContext, source: StorageRef): boolean {
  switch (source.kind) {
    case "reg":
      return true;
    case "mem":
      return false;
    case "operand": {
      const binding = operandBinding(context, source.index);

      return binding.kind !== "static.mem32";
    }
  }
}

function emitGet32(
  context: JitSirContext,
  regs: WasmSirReg32Storage,
  source: SirStorageExpr,
  helpers: WasmSirEmitHelpers
): void {
  switch (source.kind) {
    case "operand":
      emitGetBinding32(context, regs, operandBinding(context, source.index));
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
  context: JitSirContext,
  regs: WasmSirReg32Storage,
  target: SirStorageExpr,
  value: SirValueExpr,
  helpers: WasmSirEmitHelpers
): void {
  switch (target.kind) {
    case "operand":
      emitSetBinding32(context, regs, operandBinding(context, target.index), value, helpers);
      return;
    case "reg":
      regs.emitSet(target.reg, () => helpers.emitValue(value));
      return;
    case "mem":
      emitStoreMem32(context, () => helpers.emitValue(target.address), () => helpers.emitValue(value));
      return;
  }
}

function emitAddress32(context: JitSirContext, regs: WasmSirReg32Storage, source: SirStorageExpr): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address32 source for JIT SIR: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "static.mem32") {
    throw new Error(`address32 operand is not memory: ${binding.kind}`);
  }

  emitEffectiveAddress32(context.body, regs, binding.ea);
}

function emitGetBinding32(context: JitSirContext, regs: WasmSirReg32Storage, binding: JitOperandBinding): void {
  switch (binding.kind) {
    case "static.reg32":
      regs.emitGet(binding.reg);
      return;
    case "static.mem32":
      emitEffectiveAddress32(context.body, regs, binding.ea);
      emitLoadGuestU32FromStack(context);
      return;
    case "static.imm32":
      context.body.i32Const(i32(binding.value));
      return;
    case "static.relTarget":
      context.body.i32Const(i32(binding.target));
      return;
  }
}

function emitSetBinding32(
  context: JitSirContext,
  regs: WasmSirReg32Storage,
  binding: JitOperandBinding,
  value: SirValueExpr,
  helpers: WasmSirEmitHelpers
): void {
  switch (binding.kind) {
    case "static.reg32":
      regs.emitSet(binding.reg, () => helpers.emitValue(value));
      return;
    case "static.mem32":
      emitStoreMem32(
        context,
        () => emitEffectiveAddress32(context.body, regs, binding.ea),
        () => helpers.emitValue(value)
      );
      return;
    case "static.imm32":
    case "static.relTarget":
      throw new Error(`cannot set ${binding.kind} operand`);
  }
}

function emitEffectiveAddress32(body: WasmFunctionBodyEncoder, regs: WasmSirReg32Storage, ea: Mem32Operand): void {
  let hasTerm = false;

  if (ea.base !== undefined) {
    regs.emitGet(ea.base);
    hasTerm = true;
  }

  if (ea.index !== undefined) {
    regs.emitGet(ea.index);
    emitScale(body, ea.scale);

    if (hasTerm) {
      body.i32Add();
    }

    hasTerm = true;
  }

  if (ea.disp !== 0 || !hasTerm) {
    body.i32Const(i32(ea.disp));

    if (hasTerm) {
      body.i32Add();
    }
  }
}

function emitScale(body: WasmFunctionBodyEncoder, scale: Mem32Operand["scale"]): void {
  const shift = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 : 3;

  if (shift !== 0) {
    body.i32Const(shift).i32Shl();
  }
}

function emitNext(context: JitSirContext): void {
  context.body.i32Const(i32(context.nextEip));
  emitComplete(context);

  if (context.nextMode === "exit") {
    emitWasmSirExit(context.body, context.exit, ExitReason.FALLTHROUGH, () => {
      context.body.i32Const(i32(context.nextEip));
    });
  }
}

function emitNextEip(context: JitSirContext): void {
  context.body.i32Const(i32(context.nextEip));
}

function emitConditionalJump(
  context: JitSirContext,
  condition: SirValueExpr,
  taken: SirValueExpr,
  notTaken: SirValueExpr,
  helpers: WasmSirEmitHelpers
): void {
  helpers.emitValue(condition);
  context.body.ifBlock();
  emitControlExit(context, taken, ExitReason.BRANCH_TAKEN, helpers, 1);
  context.body.endBlock();
  emitControlExit(context, notTaken, ExitReason.BRANCH_NOT_TAKEN, helpers);
}

function emitHostTrap(context: JitSirContext, vector: SirValueExpr, helpers: WasmSirEmitHelpers): void {
  const vectorLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(vector);
    context.body.localSet(vectorLocal);
    context.body.i32Const(i32(context.nextEip));
    emitComplete(context);
    emitWasmSirExit(context.body, context.exit, ExitReason.HOST_TRAP, () => {
      context.body.localGet(vectorLocal);
    });
  } finally {
    context.scratch.freeLocal(vectorLocal);
  }
}

function emitControlExit(
  context: JitSirContext,
  target: SirValueExpr,
  exitReason: ExitReason,
  helpers: WasmSirEmitHelpers,
  extraDepth = 0
): void {
  const targetLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(target);
    context.body.localSet(targetLocal);
    context.body.localGet(targetLocal);
    emitComplete(context);
    emitWasmSirExit(context.body, context.exit, exitReason, () => {
      context.body.localGet(targetLocal);
    }, extraDepth);
  } finally {
    context.scratch.freeLocal(targetLocal);
  }
}

function emitComplete(context: JitSirContext): void {
  context.body.localSet(context.state.eipLocal);
  context.body
    .localGet(context.state.instructionCountLocal)
    .i32Const(1)
    .i32Add()
    .localSet(context.state.instructionCountLocal);
}

function emitLoadGuestU32FromStack(context: JitSirContext): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitWasmSirLoadGuestU32FromStack(context, addressLocal);
  } finally {
    context.scratch.freeLocal(addressLocal);
  }
}

function emitStoreMem32(
  context: JitSirContext,
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

function operandBinding(context: JitSirContext, index: number): JitOperandBinding {
  const binding = context.operands[index];

  if (binding === undefined) {
    throw new Error(`missing JIT operand binding: ${index}`);
  }

  return binding;
}
