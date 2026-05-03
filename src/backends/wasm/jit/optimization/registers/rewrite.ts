import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import {
  materializeRegisterValuesForRead,
  materializeRegisterValuesReadingReg
} from "#backends/wasm/jit/optimization/registers/materialization.js";
import {
  assignJitValue,
  type JitInstructionRewrite
} from "#backends/wasm/jit/optimization/ir/rewrite.js";
import {
  materializeRepeatedEffectiveAddressReads,
  repeatedEffectiveAddressReadMaterializationLocations,
  shouldMaterializeRepeatedRegisterRead,
  shouldRetainRegisterValue,
  syncRegisterReadCounts
} from "#backends/wasm/jit/optimization/registers/policy.js";
import {
  jitStorageReg,
  jitValueReadsReg
} from "#backends/wasm/jit/optimization/ir/values.js";
import {
  jitTrackedRegisterLocation,
  type JitTrackedLocation
} from "#backends/wasm/jit/optimization/tracked/state.js";

export type JitRegisterRewriteResult = Readonly<{
  removedSet: boolean;
  materializedSetCount: number;
  materializations: readonly JitRegisterMaterialization[];
}>;

export type JitRegisterMaterialization = Readonly<{
  location: JitTrackedLocation;
  phase: "prelude" | "beforeOp" | "beforeExit";
  reason: "preInstructionExit" | "read" | "clobber" | "policy" | "exit";
}>;

export const unchangedJitRegisterRewriteResult: JitRegisterRewriteResult = {
  removedSet: false,
  materializedSetCount: 0,
  materializations: []
};

export function rewriteRegisterAddress32(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state.tracked;
  const repeatedReadMaterializations = repeatedEffectiveAddressReadMaterializationLocations(
    op,
    instruction,
    state.tracked
  ).map((location) => registerMaterialization(location, "policy"));
  let materializedSetCount = materializeRepeatedEffectiveAddressReads(
    op,
    instruction,
    rewrite,
    state.tracked
  );
  const value = registers.valueForEffectiveAddress(op.operand, instruction.operands);

  if (value === undefined) {
    const readLocations = trackedRegisterReadLocations(
      state,
      registers.regsReadByEffectiveAddress(op.operand, instruction.operands)
    );
    materializedSetCount += materializeRegisterValuesForRead(
      rewrite,
      state,
      registers.regsReadByEffectiveAddress(op.operand, instruction.operands)
    );
    syncRegisterReadCounts(registers);
    state.recordOpValue(op, instruction);
    rewrite.ops.push(op);
    return {
      removedSet: false,
      materializedSetCount,
      materializations: [
        ...repeatedReadMaterializations,
        ...readLocations.map((location) => registerMaterialization(location, "read"))
      ]
    };
  }

  for (const reg of registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
    state.tracked.recordRegisterRead(reg);
  }

  state.recordOpValue(op, instruction);
  return {
    removedSet: false,
    materializedSetCount,
    materializations: repeatedReadMaterializations
  };
}

export function rewriteRegisterGet32(
  op: Extract<IrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state.tracked;
  const sourceReg = jitStorageReg(op.source, instruction.operands);
  const value = registers.valueForStorage(op.source, instruction.operands);

  if (value === undefined || !registers.hasStorageValue(op.source, instruction.operands)) {
    rewrite.ops.push(op);
  } else {
    if (
      sourceReg !== undefined &&
      shouldMaterializeRepeatedRegisterRead(sourceReg, value, registers)
    ) {
      const location = jitTrackedRegisterLocation(sourceReg);
      const materializedSetCount = materializeRegisterValuesForRead(rewrite, state, [sourceReg]);

      rewrite.ops.push(op);
      state.recordOpValue(op, instruction);
      return {
        removedSet: false,
        materializedSetCount,
        materializations: materializedSetCount === 0
          ? []
          : [registerMaterialization(location, "policy")]
      };
    }

    if (sourceReg !== undefined) {
      state.tracked.recordRegisterRead(sourceReg);
    }

    assignJitValue(rewrite, op.dst, value);
  }

  state.recordOpValue(op, instruction);

  return unchangedJitRegisterRewriteResult;
}

export function rewriteRegisterSet32If(
  op: Extract<IrOp, { op: "set32.if" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state.tracked;
  const target = jitStorageReg(op.target, instruction.operands);
  const readLocations = target === undefined
    ? []
    : trackedRegisterReadLocations(state, [target]);
  const dependencyLocations = target === undefined
    ? []
    : registerDependencyMaterializationLocations(state, target);
  let materializedSetCount = target === undefined
    ? 0
    : materializeRegisterValuesForRead(rewrite, state, [target]);

  if (target !== undefined) {
    materializedSetCount += materializeRegisterValuesReadingReg(rewrite, state, target);
    state.tracked.recordClobber(jitTrackedRegisterLocation(target));
  }

  syncRegisterReadCounts(registers);
  rewrite.ops.push(op);
  return {
    removedSet: false,
    materializedSetCount,
    materializations: [
      ...readLocations.map((location) => registerMaterialization(location, "read")),
      ...dependencyLocations.map((location) => registerMaterialization(location, "clobber"))
    ]
  };
}

export function rewriteRegisterSet32(
  op: Extract<IrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state.tracked;
  const target = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);
  const dependencyLocations = target === undefined
    ? []
    : registerDependencyMaterializationLocations(state, target);
  const materializedSetCount = target === undefined
    ? 0
    : materializeRegisterValuesReadingReg(rewrite, state, target);
  const materializations = dependencyLocations.map((location) =>
    registerMaterialization(location, "clobber")
  );

  syncRegisterReadCounts(registers);

  if (target !== undefined && value !== undefined) {
    if (!shouldRetainRegisterValue(value)) {
      state.tracked.recordClobber(jitTrackedRegisterLocation(target));
      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount, materializations };
    }

    state.tracked.recordRegisterValue(target, value);
    return { removedSet: true, materializedSetCount, materializations };
  }

  if (target !== undefined) {
    state.tracked.recordClobber(jitTrackedRegisterLocation(target));
  }

  rewrite.ops.push(op);
  return { removedSet: false, materializedSetCount, materializations };
}

function trackedRegisterReadLocations(
  state: JitOptimizationState,
  regs: readonly NonNullable<ReturnType<typeof jitStorageReg>>[]
): readonly JitTrackedLocation[] {
  return regs
    .filter((reg) => state.tracked.registers.has(reg))
    .map(jitTrackedRegisterLocation);
}

function registerDependencyMaterializationLocations(
  state: JitOptimizationState,
  readReg: NonNullable<ReturnType<typeof jitStorageReg>>
): readonly JitTrackedLocation[] {
  const locations: JitTrackedLocation[] = [];

  for (const [reg, value] of state.tracked.registers.entries()) {
    if (reg !== readReg && jitValueReadsReg(value, readReg)) {
      locations.push(jitTrackedRegisterLocation(reg));
    }
  }

  return locations;
}

function registerMaterialization(
  location: JitTrackedLocation,
  reason: JitRegisterMaterialization["reason"]
): JitRegisterMaterialization {
  return {
    location,
    phase: "beforeOp",
    reason
  };
}
