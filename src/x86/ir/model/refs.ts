import type { Reg32 } from "#x86/isa/types.js";
import type {
  Const32Ref,
  MemRef,
  NextEipRef,
  OperandRef,
  RegRef,
  StorageInput,
  StorageRef,
  TargetInput,
  TargetRef,
  ValueInput,
  ValueRef,
  VarRef
} from "./types.js";

export function operand(index: number): OperandRef {
  assertOperandIndex(index);
  return { kind: "operand", index };
}

export function reg32(reg: Reg32): RegRef {
  return { kind: "reg", reg };
}

export function mem32(address: ValueInput): MemRef {
  return { kind: "mem", address: toValueRef(address) };
}

export function irVar(id: number): VarRef {
  assertVarId(id);
  return { kind: "var", id };
}

export function const32(value: number): Const32Ref {
  return { kind: "const32", value: value >>> 0 };
}

export function nextEip(): NextEipRef {
  return { kind: "nextEip" };
}

export function toStorageRef(value: StorageInput): StorageRef {
  return value;
}

export function toValueRef(value: ValueInput): ValueRef {
  return typeof value === "number" ? const32(value) : value;
}

export function toTargetRef(value: TargetInput): TargetRef {
  if (typeof value === "number") {
    return const32(value);
  }

  return value;
}

function assertOperandIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`operand index must be a non-negative integer, got ${index}`);
  }
}

function assertVarId(id: number): void {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`IR var id must be a non-negative integer, got ${id}`);
  }
}
