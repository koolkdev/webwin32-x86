import type { MemOperand, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import type { OperandWidth } from "#x86/isa/types.js";
import type { IrStorageExpr, IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import { emitMaskValueToWidth } from "#backends/wasm/codegen/registers.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { emitWasmIrLoadGuestFromStack, emitWasmIrStoreGuest } from "#backends/wasm/codegen/memory.js";
import type { WasmIrReg32Storage } from "#backends/wasm/codegen/registers.js";
import type { WasmIrEmitHelpers } from "#backends/wasm/codegen/emit.js";
import type { JitExitPoint } from "#backends/wasm/jit/codegen/plan/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import type { JitIrContext } from "./ir-context.js";

export function canInlineJitGet32(context: JitIrContext, source: StorageRef): boolean {
  switch (source.kind) {
    case "reg":
      return true;
    case "mem":
      return false;
    case "operand": {
      const binding = operandBinding(context, source.index);

      return binding.kind !== "static.mem";
    }
  }
}

export function emitJitGet32(
  context: JitIrContext,
  source: IrStorageExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers
): void {
  const regs = context.state.regs;

  switch (source.kind) {
    case "operand":
      emitGetBinding32(context, operandBinding(context, source.index), accessWidth);
      return;
    case "reg":
      regs.emitGetAlias(regAccess(source.reg, accessWidth));
      return;
    case "mem":
      helpers.emitValue(source.address);
      emitLoadGuestFromStack(context, accessWidth);
      return;
  }
}

export function emitJitSet32(
  context: JitIrContext,
  target: IrStorageExpr,
  value: IrValueExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers
): void {
  const regs = context.state.regs;

  switch (target.kind) {
    case "operand":
      emitSetBinding32(context, operandBinding(context, target.index), value, helpers);
      return;
    case "reg":
      regs.emitSetAlias(regAccess(target.reg, accessWidth), () => helpers.emitValue(value));
      return;
    case "mem":
      emitStoreMem(context, () => helpers.emitValue(target.address), () => helpers.emitValue(value), accessWidth);
      return;
  }
}

export function emitJitSet32If(
  context: JitIrContext,
  condition: IrValueExpr,
  target: IrStorageExpr,
  value: IrValueExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers
): void {
  const regs = context.state.regs;

  switch (target.kind) {
    case "operand":
      emitSetBinding32If(context, operandBinding(context, target.index), condition, value, accessWidth, helpers);
      return;
    case "reg":
      regs.emitSetAliasIf(
        regAccess(target.reg, accessWidth),
        () => helpers.emitValue(condition),
        () => helpers.emitValue(value)
      );
      return;
    case "mem":
      throw new Error("JIT conditional memory writes are not supported");
  }
}

export function emitJitAddress32(context: JitIrContext, source: IrStorageExpr): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address source for JIT IR: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "static.mem") {
    throw new Error(`address operand is not memory: ${binding.kind}`);
  }

  emitEffectiveAddress32(context.body, context.state.regs, binding.ea);
}

function emitGetBinding32(context: JitIrContext, binding: JitOperandBinding, accessWidth: OperandWidth): void {
  const regs = context.state.regs;

  switch (binding.kind) {
    case "static.reg":
      assertAccessWidth(accessWidth, binding.alias.width, "read");
      regs.emitGetAlias(binding.alias);
      return;
    case "static.mem":
      emitEffectiveAddress32(context.body, regs, binding.ea);
      emitLoadGuestFromStack(context, accessWidth);
      return;
    case "static.imm32":
      context.body.i32Const(i32(binding.value));
      emitMaskValueToWidth(context.body, accessWidth);
      return;
    case "static.relTarget":
      context.body.i32Const(i32(binding.target));
      return;
  }
}

function emitSetBinding32(
  context: JitIrContext,
  binding: JitOperandBinding,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  const regs = context.state.regs;

  switch (binding.kind) {
    case "static.reg":
      regs.emitSetAlias(binding.alias, () => helpers.emitValue(value));
      return;
    case "static.mem":
      emitStoreMem(
        context,
        () => emitEffectiveAddress32(context.body, regs, binding.ea),
        () => helpers.emitValue(value),
        binding.ea.accessWidth
      );
      return;
    case "static.imm32":
    case "static.relTarget":
      throw new Error(`cannot set ${binding.kind} operand`);
  }
}

function emitSetBinding32If(
  context: JitIrContext,
  binding: JitOperandBinding,
  condition: IrValueExpr,
  value: IrValueExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers
): void {
  const regs = context.state.regs;

  switch (binding.kind) {
    case "static.reg":
      assertAccessWidth(accessWidth, binding.alias.width, "conditional write");
      regs.emitSetAliasIf(binding.alias, () => helpers.emitValue(condition), () => helpers.emitValue(value));
      return;
    case "static.mem":
      throw new Error("JIT conditional memory writes are not supported");
    case "static.imm32":
    case "static.relTarget":
      throw new Error(`cannot conditionally set ${binding.kind} operand`);
  }
}

function emitEffectiveAddress32(body: JitIrContext["body"], regs: WasmIrReg32Storage, ea: MemOperand): void {
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

function emitScale(body: JitIrContext["body"], scale: MemOperand["scale"]): void {
  const shift = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 : 3;

  if (shift !== 0) {
    body.i32Const(shift).i32Shl();
  }
}

function emitLoadGuestFromStack(context: JitIrContext, width: OperandWidth): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    const exitPoint = prepareMemoryFaultExit(context, ExitReason.MEMORY_READ_FAULT);

    emitWasmIrLoadGuestFromStack(context, addressLocal, width);
    context.completeExitPoint(exitPoint);
  } finally {
    context.scratch.freeLocal(addressLocal);
  }
}

function emitStoreMem(
  context: JitIrContext,
  emitAddress: () => void,
  emitValue: () => void,
  width: OperandWidth,
  faultExtraDepth = 1
): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitAddress();
    context.body.localSet(addressLocal);
    emitValue();
    context.body.localSet(valueLocal);
    const exitPoint = prepareMemoryFaultExit(context, ExitReason.MEMORY_WRITE_FAULT);

    emitWasmIrStoreGuest(context, addressLocal, valueLocal, width, faultExtraDepth);
    context.completeExitPoint(exitPoint);
  } finally {
    context.scratch.freeLocal(valueLocal);
    context.scratch.freeLocal(addressLocal);
  }
}

function regAccess(reg: Reg32, width: OperandWidth): RegisterAlias {
  return { name: reg, base: reg, bitOffset: 0, width };
}

function assertAccessWidth(actual: OperandWidth, expected: OperandWidth, access: string): void {
  if (actual !== expected) {
    throw new Error(`JIT ${access} width mismatch: ${actual} !== ${expected}`);
  }
}

function prepareMemoryFaultExit(context: JitIrContext, exitReason: ExitReasonValue): JitExitPoint {
  const exitPoint = context.currentExitPoint(exitReason);

  context.state.prepareExitPoint(exitPoint, () => {
    context.body.i32Const(i32(exitPoint.snapshot.eip));
  });

  return exitPoint;
}

function operandBinding(context: JitIrContext, index: number): JitOperandBinding {
  const binding = context.currentInstruction().operands[index];

  if (binding === undefined) {
    throw new Error(`missing JIT operand binding: ${index}`);
  }

  return binding;
}
