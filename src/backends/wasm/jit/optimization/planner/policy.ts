import type { StorageRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { flagProducerOwnersInvalidatedByRegisterWrite } from "#backends/wasm/jit/optimization/flags/policy.js";
import type {
  PlannedClobber,
  PlannedDrop,
  PlannedFold,
  PlannedMaterialization,
  PlannedProducer,
  PlannedRead
} from "#backends/wasm/jit/optimization/planner/plan.js";
import type { JitTrackedProducer, JitTrackedState } from "#backends/wasm/jit/optimization/tracked/state.js";
import { shouldMaterializeRepeatedRegisterRead, shouldRetainRegisterValue } from "#backends/wasm/jit/optimization/registers/policy.js";
import type { JitRegisterValues } from "#backends/wasm/jit/optimization/registers/values.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";
import type { JitValue } from "#backends/wasm/jit/optimization/ir/values.js";

export function registerWriteInvalidatesFlagProducerInputs(
  tracked: JitTrackedState,
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): boolean {
  const reg = jitStorageReg(storage, instruction.operands);

  return reg === undefined
    ? false
    : flagProducerOwnersInvalidatedByRegisterWrite(tracked, reg).length !== 0;
}

export function canPlannedProducerBeFolded(producer: PlannedProducer): boolean {
  switch (producer.producer.kind) {
    case "registerValue":
      return shouldRetainRegisterValue(producer.producer.value);
    case "flagSource":
      return producer.domain === "flags";
    case "incomingFlags":
    case "materializedFlags":
      return false;
  }
}

export function mustMaterializePlannedProducer(materialization: PlannedMaterialization): boolean {
  return materialization.kind === "materialization";
}

export function canPlannedReadUseSubstitutionOrDirectCondition(
  read: PlannedRead,
  fold: PlannedFold | undefined
): boolean {
  return (
    fold !== undefined &&
    fold.instructionIndex === read.instructionIndex &&
    fold.opIndex === read.opIndex &&
    fold.location.kind === read.location.kind
  );
}

export function plannedClobberInvalidatesFutureFold(clobber: PlannedClobber): boolean {
  return clobber.reason === "dependency";
}

export function shouldDropPlannedProducer(drop: PlannedDrop): boolean {
  return drop.reason === "folded" || drop.reason === "unusedProducer";
}

export function costPolicyForcesRegisterMaterialization(
  reg: NonNullable<ReturnType<typeof jitStorageReg>>,
  value: JitValue,
  registers: JitRegisterValues
): boolean {
  return shouldMaterializeRepeatedRegisterRead(reg, value, registers);
}

export function trackedProducerValue(producer: JitTrackedProducer): JitValue | undefined {
  return producer.kind === "registerValue" ? producer.value : undefined;
}
