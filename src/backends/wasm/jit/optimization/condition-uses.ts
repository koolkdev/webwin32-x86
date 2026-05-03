import type { ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { jitExitConditionValues } from "./op-effects.js";

export type JitConditionUse = "localCondition" | "exitCondition";

export type JitConditionUseIndex = ReadonlyMap<number, ReadonlyMap<number, JitConditionUse>>;
export type JitExitConditionValueIndex = ReadonlyMap<number, ReadonlyMap<number, readonly ValueRef[]>>;

export function indexJitExitConditionValues(block: JitIrBlock): JitExitConditionValueIndex {
  const byLocation = new Map<number, Map<number, readonly ValueRef[]>>();

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while indexing exit condition values: ${instructionIndex}`);
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while indexing exit condition values: ${instructionIndex}:${opIndex}`);
      }

      const values = jitExitConditionValues(op, instruction);

      if (values.length === 0) {
        continue;
      }

      let instructionValues = byLocation.get(instructionIndex);

      if (instructionValues === undefined) {
        instructionValues = new Map();
        byLocation.set(instructionIndex, instructionValues);
      }

      instructionValues.set(opIndex, values);
    }
  }

  return byLocation;
}

export function analyzeJitConditionUses(
  block: JitIrBlock,
  exitConditionValues: JitExitConditionValueIndex = indexJitExitConditionValues(block)
): JitConditionUseIndex {
  const byLocation = new Map<number, Map<number, JitConditionUse>>();

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing condition uses: ${instructionIndex}`);
    }

    const exitConditionVars = new Set<number>();

    for (const values of exitConditionValues.get(instructionIndex)?.values() ?? []) {
      for (const value of values) {
        if (value.kind === "var") {
          exitConditionVars.add(value.id);
        }
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
