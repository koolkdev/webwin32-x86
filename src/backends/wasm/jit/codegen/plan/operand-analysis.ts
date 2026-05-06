import type { IrStorageExpr } from "#backends/wasm/codegen/expressions.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";

export type JitOperandContext = Readonly<{
  operands: readonly JitOperandBinding[];
}>;

export function canInlineJitInstructionGet(instruction: JitOperandContext, source: StorageRef): boolean {
  switch (source.kind) {
    case "reg":
      return true;
    case "mem":
      return false;
    case "operand": {
      const binding = jitInstructionOperandBinding(instruction, source.index);

      return binding.kind !== "static.mem";
    }
  }
}

export function jitInstructionStorageRefsMayAlias(
  instruction: JitOperandContext,
  write: StorageRef,
  read: StorageRef
): boolean {
  if (write.kind === "mem" || read.kind === "mem") {
    return write.kind === "mem" && read.kind === "mem";
  }

  const writeAlias = jitStorageRegisterAlias(instruction, write);
  const readAlias = jitStorageRegisterAlias(instruction, read);

  return writeAlias !== undefined &&
    readAlias !== undefined &&
    registerAliasesMayOverlap(writeAlias, readAlias);
}

export function jitInstructionWrittenReg(
  instruction: JitOperandContext,
  storage: IrStorageExpr,
  accessWidth: OperandWidth
): Reg32 | undefined {
  return jitStorageRegisterAlias(instruction, storage, accessWidth)?.base;
}

export function jitStorageRegisterAlias(
  instruction: JitOperandContext,
  storage: StorageRef | IrStorageExpr,
  accessWidth: OperandWidth = 32
): RegisterAlias | undefined {
  switch (storage.kind) {
    case "reg":
      return { name: storage.reg, base: storage.reg, bitOffset: 0, width: accessWidth };
    case "mem":
      return undefined;
    case "operand": {
      const binding = jitInstructionOperandBinding(instruction, storage.index);

      return binding.kind === "static.reg" ? binding.alias : undefined;
    }
  }
}

function jitInstructionOperandBinding(instruction: JitOperandContext, index: number): JitOperandBinding {
  const binding = instruction.operands[index];

  if (binding === undefined) {
    throw new Error(`missing JIT operand binding: ${index}`);
  }

  return binding;
}

function registerAliasesMayOverlap(left: RegisterAlias, right: RegisterAlias): boolean {
  return left.base === right.base &&
    left.bitOffset < right.bitOffset + right.width &&
    right.bitOffset < left.bitOffset + left.width;
}
