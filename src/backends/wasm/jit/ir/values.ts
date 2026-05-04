import { reg32, type Reg32 } from "#x86/isa/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import type { OperandRef, StorageRef, ValueRef } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/lowering/operand-bindings.js";
import { requiredJitOperandBinding } from "#backends/wasm/jit/ir/operand-binding.js";

export type JitValue =
  | Readonly<{ kind: "const32"; value: number }>
  | Readonly<{ kind: "reg"; reg: Reg32 }>
  | Readonly<{
      kind: "i32.add" | "i32.sub" | "i32.xor" | "i32.or" | "i32.and";
      a: JitValue;
      b: JitValue;
    }>;

export function jitValueForStorage(
  storage: StorageRef,
  operands: readonly JitOperandBinding[],
  registerValues: ReadonlyMap<Reg32, JitValue> = new Map()
): JitValue | undefined {
  switch (storage.kind) {
    case "reg":
      return registerValues.get(storage.reg) ?? { kind: "reg", reg: storage.reg };
    case "operand": {
      const binding = requiredJitOperandBinding(operands, storage.index);

      return jitValueForOperandBinding(binding, registerValues);
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
  registerValues: ReadonlyMap<Reg32, JitValue>
): JitValue | undefined {
  const binding = requiredJitOperandBinding(operands, operand.index);

  if (binding.kind !== "static.mem32") {
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
  registerValues: ReadonlyMap<Reg32, JitValue>
): readonly Reg32[] {
  const binding = requiredJitOperandBinding(operands, operand.index);

  if (binding.kind !== "static.mem32") {
    return [];
  }

  const regs = new Set<Reg32>();

  if (binding.ea.base !== undefined && registerValues.has(binding.ea.base)) {
    regs.add(binding.ea.base);
  }

  if (binding.ea.index !== undefined && registerValues.has(binding.ea.index)) {
    regs.add(binding.ea.index);
  }

  return [...regs];
}

export function jitStorageReg(storage: StorageRef, operands: readonly JitOperandBinding[]): Reg32 | undefined {
  switch (storage.kind) {
    case "reg":
      return storage.reg;
    case "operand": {
      const binding = requiredJitOperandBinding(operands, storage.index);

      return binding.kind === "static.reg32" ? binding.reg : undefined;
    }
    case "mem":
      return undefined;
  }
}

export function jitStorageHasRegisterValue(
  storage: StorageRef,
  operands: readonly JitOperandBinding[],
  registerValues: ReadonlyMap<Reg32, JitValue>
): boolean {
  const reg = jitStorageReg(storage, operands);

  return reg !== undefined && registerValues.has(reg);
}

export function jitValueReadsReg(value: JitValue, reg: Reg32): boolean {
  switch (value.kind) {
    case "const32":
      return false;
    case "reg":
      return value.reg === reg;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      return jitValueReadsReg(value.a, reg) || jitValueReadsReg(value.b, reg);
  }
}

export function jitValueReadRegs(value: JitValue): readonly Reg32[] {
  return reg32.filter((reg) => jitValueReadsReg(value, reg));
}

export function jitValuesEqual(a: JitValue, b: JitValue): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  switch (a.kind) {
    case "const32":
      return a.value === (b as Extract<JitValue, { kind: "const32" }>).value;
    case "reg":
      return a.reg === (b as Extract<JitValue, { kind: "reg" }>).reg;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and": {
      const binary = b as Extract<JitValue, { kind: typeof a.kind }>;

      return jitValuesEqual(a.a, binary.a) && jitValuesEqual(a.b, binary.b);
    }
  }
}

export function jitValueCost(value: JitValue): number {
  switch (value.kind) {
    case "const32":
    case "reg":
      return 1;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      return 1 + jitValueCost(value.a) + jitValueCost(value.b);
  }
}

function jitValueForReg(
  reg: Reg32,
  registerValues: ReadonlyMap<Reg32, JitValue>
): JitValue {
  return registerValues.get(reg) ?? { kind: "reg", reg };
}

function jitValueForOperandBinding(
  binding: JitOperandBinding,
  registerValues: ReadonlyMap<Reg32, JitValue>
): JitValue | undefined {
  switch (binding.kind) {
    case "static.reg32":
      return registerValues.get(binding.reg) ?? { kind: "reg", reg: binding.reg };
    case "static.imm32":
      return { kind: "const32", value: i32(binding.value) };
    case "static.relTarget":
      return { kind: "const32", value: i32(binding.target) };
    case "static.mem32":
      return undefined;
  }
}
