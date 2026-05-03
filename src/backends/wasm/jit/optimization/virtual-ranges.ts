import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp, ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { jitStorageReg } from "./virtual-values.js";

export type JitIrLocation = Readonly<{
  instructionIndex: number;
  opIndex: number;
}>;

export function jitIrLocation(instructionIndex: number, opIndex: number): JitIrLocation {
  return { instructionIndex, opIndex };
}

export function jitIrLocationBefore(a: JitIrLocation, b: JitIrLocation): boolean {
  return a.instructionIndex < b.instructionIndex ||
    (a.instructionIndex === b.instructionIndex && a.opIndex < b.opIndex);
}

export function forEachJitIrOpBetween(
  block: JitIrBlock,
  after: JitIrLocation,
  before: JitIrLocation,
  visit: (
    instruction: JitIrBlock["instructions"][number],
    op: IrOp,
    location: JitIrLocation
  ) => void
): void {
  if (!jitIrLocationBefore(after, before)) {
    return;
  }

  for (let instructionIndex = after.instructionIndex; instructionIndex <= before.instructionIndex; instructionIndex += 1) {
    const instruction = requiredJitIrInstruction(block, instructionIndex);
    const startOpIndex = instructionIndex === after.instructionIndex ? after.opIndex + 1 : 0;
    const endOpIndex = instructionIndex === before.instructionIndex ? before.opIndex : instruction.ir.length;

    for (let opIndex = startOpIndex; opIndex < endOpIndex; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while iterating JIT IR range: ${instructionIndex}:${opIndex}`);
      }

      visit(instruction, op, jitIrLocation(instructionIndex, opIndex));
    }
  }
}

export function requiredJitIrInstruction(
  block: JitIrBlock,
  instructionIndex: number
): JitIrBlock["instructions"][number] {
  const instruction = block.instructions[instructionIndex];

  if (instruction === undefined) {
    throw new Error(`missing JIT instruction while reading JIT IR range: ${instructionIndex}`);
  }

  return instruction;
}

export function jitRegClobberedBetween(
  block: JitIrBlock,
  reg: Reg32,
  after: JitIrLocation,
  before: JitIrLocation
): boolean {
  let clobbered = false;

  forEachJitIrOpBetween(block, after, before, (instruction, op) => {
    if (op.op === "set32" && jitStorageReg(op.target, instruction.operands) === reg) {
      clobbered = true;
    }
  });

  return clobbered;
}

export function findJitRegWritebackBetween(
  block: JitIrBlock,
  value: ValueRef,
  after: JitIrLocation,
  before: JitIrLocation
): Readonly<{ reg: Reg32; location: JitIrLocation }> | undefined {
  let writeback: Readonly<{ reg: Reg32; location: JitIrLocation }> | undefined;

  forEachJitIrOpBetween(block, after, before, (instruction, op, location) => {
    if (writeback !== undefined || op.op !== "set32" || !sameValueRef(op.value, value)) {
      return;
    }

    const reg = jitStorageReg(op.target, instruction.operands);

    if (reg !== undefined) {
      writeback = { reg, location };
    }
  });

  return writeback;
}

function sameValueRef(a: ValueRef, b: ValueRef): boolean {
  switch (a.kind) {
    case "var":
      return b.kind === "var" && a.id === b.id;
    case "const32":
      return b.kind === "const32" && a.value === b.value;
    case "nextEip":
      return b.kind === "nextEip";
  }
}
