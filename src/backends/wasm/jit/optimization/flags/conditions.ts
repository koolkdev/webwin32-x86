import { flagProducerConditionInputNames } from "#x86/ir/model/flag-conditions.js";
import type { ValueRef } from "#x86/ir/model/types.js";
import type { JitIrOp } from "#backends/wasm/jit/types.js";
import {
  emitJitValueRef,
  type JitInstructionRewrite
} from "#backends/wasm/jit/ir/rewrite.js";
import type { JitDirectFlagCondition } from "#backends/wasm/jit/optimization/analyses/direct-flag-conditions.js";

export function emitDirectFlagCondition(
  rewrite: JitInstructionRewrite,
  op: Extract<JitIrOp, { op: "aluFlags.condition" }>,
  condition: JitDirectFlagCondition
): void {
  const inputs: Record<string, ValueRef> = {};
  const inputNames = flagProducerConditionInputNames({
    producer: condition.source.producer,
    cc: op.cc,
    inputs: flagConditionInputShape(condition)
  });

  for (const inputName of inputNames) {
    const input = condition.inputs[inputName];

    if (input?.kind !== "value") {
      throw new Error(`missing modeled flag condition input '${inputName}' for ${condition.source.producer}/${op.cc}`);
    }

    inputs[inputName] = emitJitValueRef(rewrite, input.value);
  }

  rewrite.ops.push({
    op: "jit.flagCondition",
    dst: op.dst,
    cc: op.cc,
    producer: condition.source.producer,
    writtenMask: condition.source.writtenMask,
    undefMask: condition.source.undefMask,
    inputs
  });
}

function flagConditionInputShape(condition: JitDirectFlagCondition): Readonly<Record<string, ValueRef>> {
  const inputs: Record<string, ValueRef> = {};

  for (const inputName of condition.inputNames) {
    inputs[inputName] = { kind: "const32", value: 0 };
  }

  return inputs;
}
