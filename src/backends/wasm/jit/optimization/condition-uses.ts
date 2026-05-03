import type { ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";

export type JitConditionUse = "localCondition" | "exitCondition";

export type JitConditionUseIndex = ReadonlyMap<number, ReadonlyMap<number, JitConditionUse>>;

export function analyzeJitConditionUses(block: JitIrBlock): JitConditionUseIndex {
  const byLocation = new Map<number, Map<number, JitConditionUse>>();

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing condition uses: ${instructionIndex}`);
    }

    const exitConditionVars = new Set<number>();

    for (const op of instruction.ir) {
      for (const varId of exitConditionVarReads(op)) {
        exitConditionVars.add(varId);
      }
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing condition uses: ${instructionIndex}:${opIndex}`);
      }

      if (op.op !== "aluFlags.condition") {
        continue;
      }

      let instructionUses = byLocation.get(instructionIndex);

      if (instructionUses === undefined) {
        instructionUses = new Map();
        byLocation.set(instructionIndex, instructionUses);
      }

      instructionUses.set(
        opIndex,
        exitConditionVars.has(op.dst.id) ? "exitCondition" : "localCondition"
      );
    }
  }

  return byLocation;
}

function exitConditionVarReads(op: JitIrBlock["instructions"][number]["ir"][number]): readonly number[] {
  switch (op.op) {
    case "conditionalJump":
      return varRead(op.condition);
    default:
      return [];
  }
}

function varRead(value: ValueRef): readonly number[] {
  return value.kind === "var" ? [value.id] : [];
}
