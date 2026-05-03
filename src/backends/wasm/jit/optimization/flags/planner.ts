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
import type {
  JitPlannerFact,
  JitPlannerInstructionContext,
  JitPlannerOpContext
} from "#backends/wasm/jit/optimization/planner/domain.js";
import type { PlannedMaterialization } from "#backends/wasm/jit/optimization/planner/plan.js";
import { registerWriteInvalidatesFlagProducerInputs } from "#backends/wasm/jit/optimization/planner/policy.js";
import { jitTrackedFlagsLocation } from "#backends/wasm/jit/optimization/tracked/state.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";

export type JitFlagPlannerInstruction = Readonly<{
  entryOwners: JitFlagOwners;
}>;

export type JitFlagPlannerReadResult = Readonly<{
  facts: readonly JitPlannerFact[];
  readCount: number;
}>;

export type JitFlagPlannerClobberResult = Readonly<{
  facts: readonly JitPlannerFact[];
  sourceClobberCount: number;
}>;

export type JitFlagPlannerResult = Readonly<{
  handled: boolean;
  facts: readonly JitPlannerFact[];
  sourceCount: number;
  readCount: number;
}>;

export type JitFlagPlanner = Readonly<{
  beginInstruction: (context: JitPlannerInstructionContext) => JitFlagPlannerInstruction;
  planPreInstructionExit: (
    context: JitPlannerOpContext,
    instructionPlan: JitFlagPlannerInstruction,
    exitReason: ExitReasonValue
  ) => JitFlagPlannerReadResult;
  planPostInstructionExit: (
    context: JitPlannerOpContext
  ) => JitFlagPlannerReadResult;
  planSourceClobberForOp: (
    context: JitPlannerOpContext
  ) => JitFlagPlannerClobberResult;
  planOp: (
    context: JitPlannerOpContext
  ) => JitFlagPlannerResult;
}>;

const unhandledFlagPlannerResult: JitFlagPlannerResult = {
  handled: false,
  facts: [],
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
    planPreInstructionExit(context, instructionPlan, exitReason) {
      return recordFlagRead(
        context,
        instructionPlan.entryOwners,
        "preInstructionExit",
        IR_ALU_FLAG_MASK,
        { exitReason, materializes: true }
      );
    },
    planPostInstructionExit(context) {
      return recordFlagRead(
        context,
        undefined,
        "exit",
        IR_ALU_FLAG_MASK,
        { materializes: true }
      );
    },
    planSourceClobberForOp(context) {
      return recordFlagSourceClobberForOp(context);
    },
    planOp(context) {
      return planFlagOp(context, directConditionsByLocation, neededSourceIds, flagSourcesByLocation);
    }
  };
}

function planFlagOp(
  context: JitPlannerOpContext,
  directConditionsByLocation: JitDirectFlagConditionIndex,
  neededSourceIds: ReadonlySet<number>,
  flagSourcesByLocation: ReadonlyMap<number, ReadonlyMap<number, JitFlagSource>>
): JitFlagPlannerResult {
  const { op, state } = context;

  switch (op.op) {
    case "flags.set": {
      const source = plannedFlagSource(flagSourcesByLocation, context.instructionIndex, context.opIndex);
      const location = jitTrackedFlagsLocation(source.writtenMask | source.undefMask);

      state.tracked.recordFlagSource(source);
      if (shouldDropFlagProducer(source, neededSourceIds)) {
        return {
          handled: true,
          facts: [{
            kind: "producer",
            domain: "flags",
            instructionIndex: context.instructionIndex,
            opIndex: context.opIndex,
            location,
            producer: { kind: "flagSource", source }
          }, {
            kind: "droppableProducer",
            domain: "flags",
            instructionIndex: context.instructionIndex,
            opIndex: context.opIndex,
            location,
            operation: "flags.set",
            reason: "unusedProducer"
          }],
          sourceCount: 1,
          readCount: 0
        };
      }

      return {
        handled: true,
        facts: [{
          kind: "producer",
          domain: "flags",
          instructionIndex: context.instructionIndex,
          opIndex: context.opIndex,
          location,
          producer: { kind: "flagSource", source }
        }, {
          kind: "emissionNeed",
          domain: "flags",
          instructionIndex: context.instructionIndex,
          opIndex: context.opIndex,
          location,
          phase: "atOp",
          reason: "materialize"
        }],
        sourceCount: 1,
        readCount: 0
      };
    }
    case "aluFlags.condition": {
      const conditionUse = jitConditionUseAt(
        state.context.effects,
        context.instructionIndex,
        context.opIndex
      );

      if (conditionUse === undefined) {
        return { handled: true, facts: [], sourceCount: 0, readCount: 0 };
      }

      const directCondition = directConditionsByLocation.get(context.instructionIndex)?.get(context.opIndex);
      const read = recordFlagRead(
        context,
        undefined,
        "condition",
        conditionFlagReadMask(op.cc),
        {
          cc: op.cc,
          materializes: directCondition === undefined
        }
      );

      if (directCondition === undefined) {
        return { handled: true, facts: read.facts, sourceCount: 0, readCount: read.readCount };
      }

      const location = jitTrackedFlagsLocation(directCondition.source.writtenMask | directCondition.source.undefMask);

      return {
        handled: true,
        facts: [
          ...read.facts,
          {
            kind: "foldableUse",
            domain: "flags",
            instructionIndex: context.instructionIndex,
            opIndex: context.opIndex,
            location,
            useKind: "condition"
          },
          {
            kind: "rewrite",
            domain: "flags",
            instructionIndex: context.instructionIndex,
            opIndex: context.opIndex,
            location,
            rewriteKind: "replace",
            operation: "jit.flagCondition"
          }
        ],
        sourceCount: 0,
        readCount: read.readCount
      };
    }
    case "flags.materialize": {
      const read = recordFlagRead(
        context,
        undefined,
        "materialize",
        op.mask,
        { materializes: true }
      );

      state.tracked.recordFlagsMaterialized(op.mask);
      return { handled: true, facts: read.facts, sourceCount: 0, readCount: read.readCount };
    }
    case "flags.boundary": {
      const read = recordFlagRead(
        context,
        undefined,
        "boundary",
        op.mask,
        { materializes: true }
      );

      state.tracked.recordFlagsMaterialized(op.mask);
      return { handled: true, facts: read.facts, sourceCount: 0, readCount: read.readCount };
    }
    default:
      return unhandledFlagPlannerResult;
  }
}

function recordFlagRead(
  context: JitPlannerOpContext,
  owners: JitFlagOwners | undefined,
  reason: "condition" | "materialize" | "boundary" | "preInstructionExit" | "exit",
  requiredMask: number,
  options: Readonly<{
    exitReason?: ExitReasonValue;
    cc?: ConditionCode;
    materializes?: boolean;
  }> = {}
): JitFlagPlannerReadResult {
  if (requiredMask === 0) {
    return { facts: [], readCount: 0 };
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
  const facts: JitPlannerFact[] = [{
    kind: "read",
    domain: "flags",
    instructionIndex: context.instructionIndex,
    opIndex: context.opIndex,
    location: trackedRead.location,
    reason: trackedRead.reason,
    read: trackedRead
  }];

  if (options.materializes === true) {
    facts.push({
      kind: "emissionNeed",
      domain: "flags",
      instructionIndex: context.instructionIndex,
      opIndex: context.opIndex,
      location: trackedRead.location,
      phase: flagMaterializationPhase(reason),
      reason
    });
  }

  return { facts, readCount: 1 };
}

function recordFlagSourceClobberForOp(
  context: JitPlannerOpContext
): JitFlagPlannerClobberResult {
  switch (context.op.op) {
    case "set32":
    case "set32.if":
      return recordFlagSourceClobber(context, context.op);
    default:
      return { facts: [], sourceClobberCount: 0 };
  }
}

function recordFlagSourceClobber(
  context: JitPlannerOpContext,
  op: Extract<JitIrOp, { op: "set32" | "set32.if" }>
): JitFlagPlannerClobberResult {
  const reg = jitStorageReg(op.target, context.instruction.operands);

  if (reg === undefined) {
    return { facts: [], sourceClobberCount: 0 };
  }

  if (!registerWriteInvalidatesFlagProducerInputs(context.state.tracked, op.target, context.instruction)) {
    return { facts: [], sourceClobberCount: 0 };
  }

  return {
    facts: [{
      kind: "clobber",
      domain: "flags",
      instructionIndex: context.instructionIndex,
      opIndex: context.opIndex,
      location: jitTrackedFlagsLocation(IR_ALU_FLAG_MASK),
      reg,
      reason: "dependency"
    }],
    sourceClobberCount: 1
  };
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
