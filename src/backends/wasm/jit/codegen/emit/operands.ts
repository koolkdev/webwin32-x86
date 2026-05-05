import type { MemOperand, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import type { OperandWidth } from "#x86/isa/types.js";
import type { IrStorageExpr, IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { emitWasmIrLoadGuestFromStack, emitWasmIrStoreGuest } from "#backends/wasm/codegen/memory.js";
import type { WasmIrEmitHelpers } from "#backends/wasm/codegen/emit.js";
import type { JitExitPoint } from "#backends/wasm/jit/codegen/plan/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import type { JitIrContext } from "./ir-context.js";
import {
  cleanValueWidth,
  constValueWidth,
  dirtyValueWidth,
  emitCleanValueForFullUse,
  emitMaskValueToWidth,
  emitSignExtendValueToWidth,
  maskedConstValue,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";

export function canInlineJitGet(context: JitIrContext, source: StorageRef): boolean {
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

export function jitStorageRefsMayAlias(context: JitIrContext, write: StorageRef, read: StorageRef): boolean {
  if (write.kind === "mem" || read.kind === "mem") {
    return write.kind === "mem" && read.kind === "mem";
  }

  const writeAlias = storageRegisterAlias(context, write);
  const readAlias = storageRegisterAlias(context, read);

  return writeAlias !== undefined &&
    readAlias !== undefined &&
    registerAliasesMayOverlap(writeAlias, readAlias);
}

export function emitJitGet(
  context: JitIrContext,
  source: IrStorageExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers,
  options: WasmIrEmitValueOptions = {}
): ValueWidth {
  const regs = context.state.regs;

  switch (source.kind) {
    case "operand":
      return emitGetBinding(context, operandBinding(context, source.index), accessWidth, options);
    case "reg":
      return regs.emitReadAlias(regAccess(source.reg, accessWidth), options);
    case "mem":
      helpers.emitValue(source.address, { requestedWidth: 32 });
      emitLoadGuestFromStack(context, accessWidth, options.signed === true);
      return signedLoadValueWidth(accessWidth, options);
  }
}

export function emitJitSet(
  context: JitIrContext,
  target: IrStorageExpr,
  value: IrValueExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers
): void {
  switch (target.kind) {
    case "operand":
      emitSetBinding(context, operandBinding(context, target.index), value, helpers);
      return;
    case "reg":
      emitSetRegisterAlias(context, regAccess(target.reg, accessWidth), value, helpers);
      return;
    case "mem":
      emitStoreMem(
        context,
        () => {
          helpers.emitValue(target.address, { requestedWidth: 32 });
        },
        () => helpers.emitValue(value),
        accessWidth
      );
      return;
  }
}

export function emitJitSetIf(
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
      emitSetBindingIf(context, operandBinding(context, target.index), condition, value, accessWidth, helpers);
      return;
    case "reg":
      regs.emitWriteAliasIf(
        regAccess(target.reg, accessWidth),
        () => helpers.emitValue(condition, { requestedWidth: 32 }),
        () => helpers.emitValue(value)
      );
      return;
    case "mem":
      throw new Error("JIT conditional memory writes are not supported");
  }
}

export function emitJitAddress(context: JitIrContext, source: IrStorageExpr): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address source for JIT IR: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "static.mem") {
    throw new Error(`address operand is not memory: ${binding.kind}`);
  }

  emitEffectiveAddress(context.body, context.state.regs, binding.ea);
}

function emitGetBinding(
  context: JitIrContext,
  binding: JitOperandBinding,
  accessWidth: OperandWidth,
  options: WasmIrEmitValueOptions = {}
): ValueWidth {
  const regs = context.state.regs;

  switch (binding.kind) {
    case "static.reg":
      assertAccessWidth(accessWidth, binding.alias.width, "read");
      return regs.emitReadAlias(binding.alias, options);
    case "static.mem":
      emitEffectiveAddress(context.body, regs, binding.ea);
      emitLoadGuestFromStack(context, accessWidth, options.signed === true);
      return signedLoadValueWidth(accessWidth, options);
    case "static.imm32":
      if (options.signed === true && accessWidth < 32) {
        context.body.i32Const(i32(binding.value));
        return emitSignExtendValueToWidth(context.body, accessWidth as 8 | 16);
      }

      if (options.widthInsensitive !== true && accessWidth < 32) {
        const masked = maskedConstValue(binding.value, accessWidth);

        context.body.i32Const(masked);
        return constValueWidth(masked);
      }

      context.body.i32Const(i32(binding.value));
      return options.widthInsensitive === true && accessWidth < 32
        ? dirtyValueWidth(accessWidth)
        : emitMaskValueToWidth(context.body, accessWidth, constValueWidth(binding.value));
    case "static.relTarget":
      context.body.i32Const(i32(binding.target));
      return constValueWidth(binding.target);
  }
}

function emitSetBinding(
  context: JitIrContext,
  binding: JitOperandBinding,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  const regs = context.state.regs;

  switch (binding.kind) {
    case "static.reg":
      emitSetRegisterAlias(context, binding.alias, value, helpers);
      return;
    case "static.mem":
      emitStoreMem(
        context,
        () => {
          emitEffectiveAddress(context.body, regs, binding.ea);
        },
        () => helpers.emitValue(value),
        binding.ea.accessWidth
      );
      return;
    case "static.imm32":
    case "static.relTarget":
      throw new Error(`cannot set ${binding.kind} operand`);
  }
}

function emitSetRegisterAlias(
  context: JitIrContext,
  target: RegisterAlias,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  const rebindLocal = rebindLocalForSetValue(context, target, value);

  context.state.regs.emitWriteAlias(target, rebindLocal === undefined
    ? () => helpers.emitValue(value)
    : {
        emitValue: () => helpers.emitValue(value),
        rebindLocal
      });
}

function emitSetBindingIf(
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
      regs.emitWriteAliasIf(
        binding.alias,
        () => helpers.emitValue(condition, { requestedWidth: 32 }),
        () => helpers.emitValue(value)
      );
      return;
    case "static.mem":
      throw new Error("JIT conditional memory writes are not supported");
    case "static.imm32":
    case "static.relTarget":
      throw new Error(`cannot conditionally set ${binding.kind} operand`);
  }
}

function emitEffectiveAddress(body: JitIrContext["body"], regs: JitIrContext["state"]["regs"], ea: MemOperand): void {
  let hasTerm = false;

  if (ea.base !== undefined) {
    regs.emitReadReg32(ea.base);
    hasTerm = true;
  }

  if (ea.index !== undefined) {
    regs.emitReadReg32(ea.index);
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

function emitLoadGuestFromStack(context: JitIrContext, width: OperandWidth, signed = false): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    const exitPoint = prepareMemoryFaultExit(context, ExitReason.MEMORY_READ_FAULT);

    emitWasmIrLoadGuestFromStack(context, addressLocal, width, 1, signed);
    context.completeExitPoint(exitPoint);
  } finally {
    context.scratch.freeLocal(addressLocal);
  }
}

function signedLoadValueWidth(width: OperandWidth, options: WasmIrEmitValueOptions): ValueWidth {
  if (options.signed === true && width < 32) {
    return cleanValueWidth(32);
  }

  return cleanValueWidth(width);
}

function emitStoreMem(
  context: JitIrContext,
  emitAddress: () => void,
  emitValue: () => ValueWidth,
  width: OperandWidth,
  faultExtraDepth = 1
): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitAddress();
    context.body.localSet(addressLocal);
    const valueWidth = emitValue();
    if (width === 32) {
      emitCleanValueForFullUse(context.body, valueWidth);
    }
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

function storageRegisterAlias(context: JitIrContext, storage: StorageRef | IrStorageExpr): RegisterAlias | undefined {
  switch (storage.kind) {
    case "reg":
      return regAccess(storage.reg, 32);
    case "mem":
      return undefined;
    case "operand": {
      const binding = operandBinding(context, storage.index);

      return binding.kind === "static.reg" ? binding.alias : undefined;
    }
  }
}

function registerAliasesMayOverlap(left: RegisterAlias, right: RegisterAlias): boolean {
  return left.base === right.base &&
    left.bitOffset < right.bitOffset + right.width &&
    right.bitOffset < left.bitOffset + left.width;
}

function rebindLocalForSetValue(
  context: JitIrContext,
  target: RegisterAlias,
  value: IrValueExpr
): number | undefined {
  // Only exact full-width register sources can be rebound. Expressions,
  // constants, memory loads, signed/narrow reads, and conditionals all continue
  // through the normal value-emission path.
  if (target.width !== 32 || value.kind !== "source" || value.accessWidth !== 32 || value.signed === true) {
    return undefined;
  }

  const sourceAlias = storageRegisterAlias(context, value.source);

  if (sourceAlias === undefined) {
    return undefined;
  }

  return context.state.regs.rebindableLocalForAlias(sourceAlias);
}
