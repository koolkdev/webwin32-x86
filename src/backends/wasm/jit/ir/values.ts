import { reg32, type OperandWidth, type Reg32 } from "#x86/isa/types.js";
import type { IrBinaryValueOpName, IrUnaryValueOpName } from "#x86/ir/model/types.js";
import { i32, widthMask } from "#x86/state/cpu-state.js";
import type { OperandRef, StorageRef, ValueRef } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import {
  extractJitRegisterAccessValue,
  fullRegisterValueForEntry,
  jitStorageRegisterAccess,
  readRegisterValueEntry,
  registerValueEntryHasFullValue,
  type JitRegisterAccess,
  type JitRegisterValueMap
} from "#backends/wasm/jit/ir/register-lane-values.js";

export type JitBinaryValue = Readonly<{
  kind: IrBinaryValueOpName;
  a: JitValue;
  b: JitValue;
}>;

export type JitUnaryValue = Readonly<{
  kind: IrUnaryValueOpName;
  value: JitValue;
}>;

export type JitValue =
  | Readonly<{ kind: "const32"; value: number }>
  | Readonly<{ kind: "reg"; reg: Reg32 }>
  | JitUnaryValue
  | JitBinaryValue;

export function jitValueForStorage(
  storage: StorageRef,
  operands: readonly JitOperandBinding[],
  registerValues: JitRegisterValueMap = new Map(),
  accessWidth: OperandWidth = 32,
  signed = false
): JitValue | undefined {
  const value = jitValueForStorageUnsigned(storage, operands, registerValues, accessWidth);

  return value === undefined || !signed || accessWidth >= 32
    ? value
    : signExtendJitValue(value, accessWidth as 8 | 16);
}

function jitValueForStorageUnsigned(
  storage: StorageRef,
  operands: readonly JitOperandBinding[],
  registerValues: JitRegisterValueMap,
  accessWidth: OperandWidth
): JitValue | undefined {
  switch (storage.kind) {
    case "reg":
      return jitValueForRegisterAccess({ reg: storage.reg, width: accessWidth, bitOffset: 0 }, registerValues);
    case "operand": {
      const binding = operands[storage.index]!;

      return jitValueForOperandBinding(binding, registerValues, accessWidth);
    }
    case "mem":
      return undefined;
  }
}

export function jitValueForValue(
  value: ValueRef,
  localValues: ReadonlyMap<number, JitValue>
): JitValue | undefined {
  switch (value.kind) {
    case "var":
      return localValues.get(value.id);
    case "const32":
      return { kind: "const32", value: i32(value.value) };
    case "nextEip":
      return undefined;
  }
}

export function jitValueForEffectiveAddress(
  operand: OperandRef,
  operands: readonly JitOperandBinding[],
  registerValues: JitRegisterValueMap
): JitValue | undefined {
  const binding = operands[operand.index]!;

  if (binding.kind !== "static.mem") {
    return undefined;
  }

  const terms: JitValue[] = [];

  if (binding.ea.base !== undefined) {
    terms.push(jitValueForReg(binding.ea.base, registerValues));
  }

  if (binding.ea.index !== undefined) {
    if (binding.ea.scale !== 1) {
      return undefined;
    }

    terms.push(jitValueForReg(binding.ea.index, registerValues));
  }

  if (binding.ea.disp !== 0 || terms.length === 0) {
    terms.push({ kind: "const32", value: i32(binding.ea.disp) });
  }

  return terms.reduce((a, b) => ({ kind: "i32.add", a, b }));
}

export function jitRegisterValuesReadByEffectiveAddress(
  operand: OperandRef,
  operands: readonly JitOperandBinding[],
  registerValues: JitRegisterValueMap
): readonly Reg32[] {
  const binding = operands[operand.index]!;

  if (binding.kind !== "static.mem") {
    return [];
  }

  const regs = new Set<Reg32>();

  if (binding.ea.base !== undefined && registerValueEntryHasFullValue(registerValues.get(binding.ea.base))) {
    regs.add(binding.ea.base);
  }

  if (binding.ea.index !== undefined && registerValueEntryHasFullValue(registerValues.get(binding.ea.index))) {
    regs.add(binding.ea.index);
  }

  return [...regs];
}

export function jitStorageReg(storage: StorageRef, operands: readonly JitOperandBinding[]): Reg32 | undefined {
  return jitStorageRegisterAccess(storage, operands)?.reg;
}

export function jitStorageHasRegisterValue(
  storage: StorageRef,
  operands: readonly JitOperandBinding[],
  registerValues: JitRegisterValueMap,
  accessWidth: OperandWidth = 32
): boolean {
  const access = jitStorageRegisterAccess(storage, operands, accessWidth);

  return access !== undefined &&
    readRegisterValueEntry(registerValues.get(access.reg), access.width, access.bitOffset) !== undefined;
}

export function jitValueReadsReg(value: JitValue, reg: Reg32): boolean {
  if (jitValueIsBinary(value)) {
    return jitValueReadsReg(value.a, reg) || jitValueReadsReg(value.b, reg);
  }

  if (jitValueIsUnary(value)) {
    return jitValueReadsReg(value.value, reg);
  }

  switch (value.kind) {
    case "const32":
      return false;
    case "reg":
      return value.reg === reg;
  }
}

export function jitValueReadRegs(value: JitValue): readonly Reg32[] {
  return reg32.filter((reg) => jitValueReadsReg(value, reg));
}

export function jitValuesEqual(a: JitValue, b: JitValue): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  if (jitValueIsBinary(a)) {
    const binary = b as JitBinaryValue;

    return jitValuesEqual(a.a, binary.a) && jitValuesEqual(a.b, binary.b);
  }

  if (jitValueIsUnary(a)) {
    return jitValuesEqual(a.value, (b as JitUnaryValue).value);
  }

  switch (a.kind) {
    case "const32":
      return a.value === (b as Extract<JitValue, { kind: "const32" }>).value;
    case "reg":
      return a.reg === (b as Extract<JitValue, { kind: "reg" }>).reg;
  }
}

export function jitValueCost(value: JitValue): number {
  if (jitValueIsBinary(value)) {
    return 1 + jitValueCost(value.a) + jitValueCost(value.b);
  }

  if (jitValueIsUnary(value)) {
    return 1 + jitValueCost(value.value);
  }

  switch (value.kind) {
    case "const32":
    case "reg":
      return 1;
  }
}

export function jitValueIsBinary(value: JitValue): value is JitBinaryValue {
  return "a" in value && "b" in value;
}

export function jitValueIsUnary(value: JitValue): value is JitUnaryValue {
  return value.kind === "i32.extend8_s" || value.kind === "i32.extend16_s";
}

function jitValueForReg(
  reg: Reg32,
  registerValues: JitRegisterValueMap
): JitValue {
  return fullRegisterValueForEntry(registerValues.get(reg)) ?? { kind: "reg", reg };
}

function jitValueForOperandBinding(
  binding: JitOperandBinding,
  registerValues: JitRegisterValueMap,
  accessWidth: OperandWidth
): JitValue | undefined {
  switch (binding.kind) {
    case "static.reg":
      return jitValueForRegisterAccess({
        reg: binding.alias.base,
        width: binding.alias.width,
        bitOffset: binding.alias.bitOffset
      }, registerValues);
    case "static.imm32":
      return extractJitRegisterAccessValue({ kind: "const32", value: i32(binding.value) }, accessWidth, 0);
    case "static.relTarget":
      return extractJitRegisterAccessValue({ kind: "const32", value: i32(binding.target) }, accessWidth, 0);
    case "static.mem":
      return undefined;
  }
}

function signExtendJitValue(value: JitValue, width: 8 | 16): JitValue {
  if (value.kind === "const32") {
    return { kind: "const32", value: signExtendConst(value.value, width) };
  }

  return {
    kind: width === 8 ? "i32.extend8_s" : "i32.extend16_s",
    value
  };
}

function signExtendConst(value: number, width: 8 | 16): number {
  const masked = value & widthMask(width);
  const shift = 32 - width;

  return i32((masked << shift) >> shift);
}

function jitValueForRegisterAccess(
  access: JitRegisterAccess,
  registerValues: JitRegisterValueMap
): JitValue | undefined {
  const value = readRegisterValueEntry(registerValues.get(access.reg), access.width, access.bitOffset);

  if (value !== undefined) {
    return value;
  }

  return access.width === 32 && access.bitOffset === 0
    ? { kind: "reg", reg: access.reg }
    : undefined;
}
