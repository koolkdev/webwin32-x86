import type { StorageRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { flagProducerOwnersInvalidatedByRegisterWrite } from "#backends/wasm/jit/optimization/flags/policy.js";
import type { JitTrackedState } from "#backends/wasm/jit/optimization/tracked/state.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";

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
