import { conditionFlagReadMask, IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import type { ConditionCode } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { jitConditionUseAt } from "#backends/wasm/jit/optimization/effects/effects.js";
import {
  analyzeJitFlags,
  type JitFlagAnalysis,
  type JitFlagRead
} from "#backends/wasm/jit/optimization/flags/analysis.js";
import type { JitFlagSource } from "#backends/wasm/jit/optimization/flags/sources.js";
import type { JitFlagOwners } from "#backends/wasm/jit/optimization/flags/owners.js";
import {
  indexDirectFlagConditions,
  type JitDirectFlagConditionIndex
} from "#backends/wasm/jit/optimization/flags/conditions.js";
import { shouldDropFlagProducer, shouldMaterializeFlagRead } from "#backends/wasm/jit/optimization/flags/policy.js";
import type { JitPlannerInstructionContext, JitPlannerOpContext } from "#backends/wasm/jit/optimization/planner/domain.js";
import type {
  JitOptimizationPlanRecord,
  PlannedMaterialization
} from "#backends/wasm/jit/optimization/planner/plan.js";
import { registerWriteInvalidatesFlagProducerInputs } from "#backends/wasm/jit/optimization/planner/policy.js";
import { jitTrackedFlagsLocation } from "#backends/wasm/jit/optimization/tracked/state.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";

export type JitFlagPlannerInstruction = Readonly<{
  entryOwners: JitFlagOwners;
}>;

export type JitFlagPlannerResult = Readonly<{
  handled: boolean;
  sourceCount: number;
  readCount: number;
}>;

export type JitFlagPlanner = Readonly<{
  beginInstruction: (context: JitPlannerInstructionContext) => JitFlagPlannerInstruction;
  planPreInstructionExit: (
    context: JitPlannerOpContext,
    instructionPlan: JitFlagPlannerInstruction,
    exitReason: ExitReasonValue,
    records: JitOptimizationPlanRecord[]
  ) => number;
  planPostInstructionExit: (
    context: JitPlannerOpContext,
    records: JitOptimizationPlanRecord[]
  ) => number;
  planSourceClobberForOp: (
    context: JitPlannerOpContext,
    records: JitOptimizationPlanRecord[]
  ) => number;
  planOp: (
    context: JitPlannerOpContext,
    records: JitOptimizationPlanRecord[]
  ) => JitFlagPlannerResult;
}>;

const unhandledFlagPlannerResult: JitFlagPlannerResult = {
  handled: false,
  sourceCount: 0,
  readCount: 0
};

export function createFlagPlanner(
  block: JitIrBlock,
  optimizationAnalysis: JitOptimizationAnalysis
): JitFlagPlanner {
  const flagAnalysis = analyzeJitFlags(block, optimizationAnalysis);
  const directConditionsByLocation = indexDirectFlagConditions(block, flagAnalysis);
  const neededSourceIds = neededPlannedFlagSourceIds(flagAnalysis, directConditionsByLocation);
  const flagSourcesByLocation = indexPlannedFlagSourcesByLocation(flagAnalysis);

  return {
    beginInstruction(context) {
      return {
        entryOwners: context.state.tracked.cloneFlagOwners()
      };
    },
    planPreInstructionExit(context, instructionPlan, exitReason, records) {
      return recordFlagRead(
        context,
        records,
        instructionPlan.entryOwners,
        "preInstructionExit",
        IR_ALU_FLAG_MASK,
        { exitReason, materializes: true }
      );
    },
    planPostInstructionExit(context, records) {
      return recordFlagRead(
        context,
        records,
        undefined,
        "exit",
        IR_ALU_FLAG_MASK,
        { materializes: true }
      );
    },
    planSourceClobberForOp(context, records) {
      return recordFlagSourceClobberForOp(context, records);
    },
    planOp(context, records) {
      return planFlagOp(context, records, directConditionsByLocation, neededSourceIds, flagSourcesByLocation);
    }
  };
}

function planFlagOp(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  directConditionsByLocation: JitDirectFlagConditionIndex,
  neededSourceIds: ReadonlySet<number>,
  flagSourcesByLocation: ReadonlyMap<number, ReadonlyMap<number, JitFlagSource>>
): JitFlagPlannerResult {
  const { op, state } = context;

  switch (op.op) {
    case "flags.set": {
      const source = plannedFlagSource(flagSourcesByLocation, context.instructionIndex, context.opIndex);

      state.tracked.recordFlagSource(source);
      records.push({
        kind: "producer",
        domain: "flags",
        instructionIndex: context.instructionIndex,
        opIndex: context.opIndex,
        location: jitTrackedFlagsLocation(source.writtenMask | source.undefMask),
        producer: { kind: "flagSource", source }
      });
      if (shouldDropFlagProducer(source, neededSourceIds)) {
        records.push({
          kind: "drop",
          domain: "flags",
          instructionIndex: context.instructionIndex,
          opIndex: context.opIndex,
          op: "flags.set",
          reason: "unusedProducer"
        });
      } else {
        records.push({
          kind: "materialization",
          domain: "flags",
          instructionIndex: context.instructionIndex,
          opIndex: context.opIndex,
          location: jitTrackedFlagsLocation(source.writtenMask | source.undefMask),
          phase: "atOp",
          reason: "materialize"
        });
      }
      return { handled: true, sourceCount: 1, readCount: 0 };
    }
    case "aluFlags.condition": {
      const conditionUse = jitConditionUseAt(
        state.context.effects,
        context.instructionIndex,
        context.opIndex
      );

      if (conditionUse === undefined) {
        return { handled: true, sourceCount: 0, readCount: 0 };
      }

      const directCondition = directConditionsByLocation.get(context.instructionIndex)?.get(context.opIndex);
      const readCount = recordFlagRead(
        context,
        records,
        undefined,
        "condition",
        conditionFlagReadMask(op.cc),
        {
          cc: op.cc,
          materializes: directCondition === undefined
        }
      );

      if (directCondition !== undefined) {
        records.push({
          kind: "fold",
          domain: "flags",
          instructionIndex: context.instructionIndex,
          opIndex: context.opIndex,
          location: jitTrackedFlagsLocation(directCondition.source.writtenMask | directCondition.source.undefMask),
          foldKind: "flagCondition"
        });
      }
      return { handled: true, sourceCount: 0, readCount };
    }
    case "flags.materialize": {
      const readCount = recordFlagRead(
        context,
        records,
        undefined,
        "materialize",
        op.mask,
        { materializes: true }
      );

      state.tracked.recordFlagsMaterialized(op.mask);
      return { handled: true, sourceCount: 0, readCount };
    }
    case "flags.boundary": {
      const readCount = recordFlagRead(
        context,
        records,
        undefined,
        "boundary",
        op.mask,
        { materializes: true }
      );

      state.tracked.recordFlagsMaterialized(op.mask);
      return { handled: true, sourceCount: 0, readCount };
    }
    default:
      return unhandledFlagPlannerResult;
  }
}

function recordFlagRead(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  owners: JitFlagOwners | undefined,
  reason: "condition" | "materialize" | "boundary" | "preInstructionExit" | "exit",
  requiredMask: number,
  options: Readonly<{
    exitReason?: ExitReasonValue;
    cc?: ConditionCode;
    materializes?: boolean;
  }> = {}
): number {
  if (requiredMask === 0) {
    return 0;
  }

  const read = {
    instructionIndex: context.instructionIndex,
    opIndex: context.opIndex,
    reason,
    requiredMask,
    ...(options.exitReason === undefined ? {} : { exitReason: options.exitReason }),
    ...(options.cc === undefined ? {} : { cc: options.cc })
  };

  const trackedRead = owners === undefined
    ? context.state.tracked.recordFlagRead(read)
    : context.state.tracked.recordFlagRead(read, owners);

  records.push({
    kind: "read",
    domain: "flags",
    instructionIndex: context.instructionIndex,
    opIndex: context.opIndex,
    location: trackedRead.location,
    reason: trackedRead.reason,
    read: trackedRead
  });

  if (options.materializes === true) {
    records.push({
      kind: "materialization",
      domain: "flags",
      instructionIndex: context.instructionIndex,
      opIndex: context.opIndex,
      location: trackedRead.location,
      phase: flagMaterializationPhase(reason),
      reason
    });
  }

  return 1;
}

function recordFlagSourceClobberForOp(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[]
): number {
  switch (context.op.op) {
    case "set32":
    case "set32.if":
      return recordFlagSourceClobber(context, records, context.op);
    default:
      return 0;
  }
}

function recordFlagSourceClobber(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  op: Extract<JitIrOp, { op: "set32" | "set32.if" }>
): number {
  const reg = jitStorageReg(op.target, context.instruction.operands);

  if (reg === undefined) {
    return 0;
  }

  if (!registerWriteInvalidatesFlagProducerInputs(context.state.tracked, op.target, context.instruction)) {
    return 0;
  }

  records.push({
    kind: "clobber",
    domain: "flags",
    instructionIndex: context.instructionIndex,
    opIndex: context.opIndex,
    location: jitTrackedFlagsLocation(IR_ALU_FLAG_MASK),
    reg,
    reason: "dependency"
  });
  return 1;
}

function flagMaterializationPhase(
  reason: "condition" | "materialize" | "boundary" | "preInstructionExit" | "exit"
): PlannedMaterialization["phase"] {
  switch (reason) {
    case "preInstructionExit":
      return "prelude";
    case "exit":
      return "beforeExit";
    case "condition":
    case "materialize":
    case "boundary":
      return "atOp";
  }
}

function neededPlannedFlagSourceIds(
  analysis: JitFlagAnalysis,
  directConditionsByLocation: JitDirectFlagConditionIndex
): ReadonlySet<number> {
  const neededSourceIds = new Set<number>();

  for (const read of analysis.reads) {
    if (!shouldMaterializePlannedFlagRead(read, directConditionsByLocation)) {
      continue;
    }

    for (const { owner } of read.owners) {
      if (owner.kind === "producer") {
        neededSourceIds.add(owner.source.id);
      }
    }
  }

  return neededSourceIds;
}

function shouldMaterializePlannedFlagRead(
  read: JitFlagRead,
  directConditionsByLocation: JitDirectFlagConditionIndex
): boolean {
  return shouldMaterializeFlagRead(
    read,
    directConditionsByLocation.get(read.instructionIndex)?.get(read.opIndex)
  );
}

function indexPlannedFlagSourcesByLocation(
  analysis: JitFlagAnalysis
): ReadonlyMap<number, ReadonlyMap<number, JitFlagSource>> {
  const sourcesByLocation = new Map<number, Map<number, JitFlagSource>>();

  for (const source of analysis.sources) {
    let instructionSources = sourcesByLocation.get(source.instructionIndex);

    if (instructionSources === undefined) {
      instructionSources = new Map();
      sourcesByLocation.set(source.instructionIndex, instructionSources);
    }

    instructionSources.set(source.opIndex, source);
  }

  return sourcesByLocation;
}

function plannedFlagSource(
  sourcesByLocation: ReadonlyMap<number, ReadonlyMap<number, JitFlagSource>>,
  instructionIndex: number,
  opIndex: number
): JitFlagSource {
  const source = sourcesByLocation.get(instructionIndex)?.get(opIndex);

  if (source === undefined) {
    throw new Error(`missing planned JIT flag source: ${instructionIndex}:${opIndex}`);
  }

  return source;
}
