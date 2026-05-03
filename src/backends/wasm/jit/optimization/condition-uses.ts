import type { ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { walkJitIrBlockOps } from "./ir-walk.js";
import { jitExitConditionValues, jitLocalConditionValues } from "./op-effects.js";

export type JitConditionUse = "localCondition" | "exitCondition";

export type JitConditionUseIndex = ReadonlyMap<number, ReadonlyMap<number, JitConditionUse>>;
export type JitLocalConditionValueIndex = ReadonlyMap<number, ReadonlyMap<number, readonly ValueRef[]>>;
export type JitExitConditionValueIndex = ReadonlyMap<number, ReadonlyMap<number, readonly ValueRef[]>>;

export function indexJitLocalConditionValues(block: JitIrBlock): JitLocalConditionValueIndex {
  const byLocation = new Map<number, Map<number, readonly ValueRef[]>>();

  walkJitIrBlockOps(block, (_instruction, op, location) => {
    const values = jitLocalConditionValues(op);

    if (values.length !== 0) {
      setConditionValues(byLocation, location.instructionIndex, location.opIndex, values);
    }
  }, "indexing local condition values");

  return byLocation;
}

export function indexJitExitConditionValues(block: JitIrBlock): JitExitConditionValueIndex {
  const byLocation = new Map<number, Map<number, readonly ValueRef[]>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const values = jitExitConditionValues(op, instruction);

    if (values.length !== 0) {
      setConditionValues(byLocation, location.instructionIndex, location.opIndex, values);
    }
  }, "indexing exit condition values");

  return byLocation;
}

export function analyzeJitConditionUses(
  block: JitIrBlock,
  localConditionValues: JitLocalConditionValueIndex = indexJitLocalConditionValues(block),
  exitConditionValues: JitExitConditionValueIndex = indexJitExitConditionValues(block)
): JitConditionUseIndex {
  const byLocation = new Map<number, Map<number, JitConditionUse>>();

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing condition uses: ${instructionIndex}`);
    }

    const exitConditionVars = new Set<number>();
    const localConditionVars = new Set<number>();

    for (const values of localConditionValues.get(instructionIndex)?.values() ?? []) {
      addConditionVars(localConditionVars, values);
    }

    for (const values of exitConditionValues.get(instructionIndex)?.values() ?? []) {
      addConditionVars(exitConditionVars, values);
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing condition uses: ${instructionIndex}:${opIndex}`);
      }

      if (op.op !== "aluFlags.condition") {
        continue;
      }

      const conditionUse = conditionUseForVar(op.dst.id, localConditionVars, exitConditionVars);

      if (conditionUse === undefined) {
        continue;
      }

      let instructionUses = byLocation.get(instructionIndex);

      if (instructionUses === undefined) {
        instructionUses = new Map();
        byLocation.set(instructionIndex, instructionUses);
      }

      instructionUses.set(opIndex, conditionUse);
    }
  }

  return byLocation;
}

function conditionUseForVar(
  varId: number,
  localConditionVars: ReadonlySet<number>,
  exitConditionVars: ReadonlySet<number>
): JitConditionUse | undefined {
  if (exitConditionVars.has(varId)) {
    return "exitCondition";
  }

  if (localConditionVars.has(varId)) {
    return "localCondition";
  }

  return undefined;
}

function addConditionVars(vars: Set<number>, values: readonly ValueRef[]): void {
  for (const value of values) {
    if (value.kind === "var") {
      vars.add(value.id);
    }
  }
}

function setConditionValues(
  byLocation: Map<number, Map<number, readonly ValueRef[]>>,
  instructionIndex: number,
  opIndex: number,
  values: readonly ValueRef[]
): void {
  let instructionValues = byLocation.get(instructionIndex);

  if (instructionValues === undefined) {
    instructionValues = new Map();
    byLocation.set(instructionIndex, instructionValues);
  }

  instructionValues.set(opIndex, values);
}
