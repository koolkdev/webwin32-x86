import type { Mem32Operand } from "../../arch/x86/isa/types.js";
import type { SirStorageExpr, SirValueExpr } from "../../arch/x86/sir/expressions.js";
import type { StorageRef } from "../../arch/x86/sir/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { wasmValueType } from "../encoder/types.js";
import { emitWasmSirLoadGuestU32FromStack, emitWasmSirStoreGuestU32 } from "../sir/memory.js";
import type { WasmSirReg32Storage } from "../sir/registers.js";
import type { WasmSirEmitHelpers } from "../sir/lower.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import type { JitSirContext } from "./sir-context.js";

export function canInlineJitGet32(context: JitSirContext, source: StorageRef): boolean {
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

export function emitJitGet32(
  context: JitSirContext,
  source: SirStorageExpr,
  helpers: WasmSirEmitHelpers
): void {
  const regs = context.state.regs;

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

export function emitJitSet32(
  context: JitSirContext,
  target: SirStorageExpr,
  value: SirValueExpr,
  helpers: WasmSirEmitHelpers
): void {
  const regs = context.state.regs;

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

export function emitJitAddress32(context: JitSirContext, source: SirStorageExpr): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address32 source for JIT SIR: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "static.mem32") {
    throw new Error(`address32 operand is not memory: ${binding.kind}`);
  }

  emitEffectiveAddress32(context.body, context.state.regs, binding.ea);
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

function emitEffectiveAddress32(body: JitSirContext["body"], regs: WasmSirReg32Storage, ea: Mem32Operand): void {
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

function emitScale(body: JitSirContext["body"], scale: Mem32Operand["scale"]): void {
  const shift = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 : 3;

  if (shift !== 0) {
    body.i32Const(shift).i32Shl();
  }
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
