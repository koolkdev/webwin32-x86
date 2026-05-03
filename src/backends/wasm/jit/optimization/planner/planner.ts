import { conditionFlagReadMask, IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import type { ConditionCode, StorageRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type {
  JitIrBlock,
  JitIrBlockInstruction,
  JitIrOp
} from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { pruneDeadJitLocalValues } from "#backends/wasm/jit/optimization/passes/dead-local-values.js";
import {
  jitConditionUseAt,
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt
} from "#backends/wasm/jit/optimization/effects/effects.js";
import {
  analyzeJitFlags,
  type JitFlagAnalysis,
  type JitFlagRead
} from "#backends/wasm/jit/optimization/flags/analysis.js";
import type { JitFlagSource } from "#backends/wasm/jit/optimization/flags/sources.js";
import {
  indexDirectFlagConditions,
  type JitDirectFlagConditionIndex
} from "#backends/wasm/jit/optimization/flags/conditions.js";
import { shouldDropFlagProducer, shouldMaterializeFlagRead } from "#backends/wasm/jit/optimization/flags/policy.js";
import type { JitIrOptimizationPipelineResult } from "#backends/wasm/jit/optimization/pipeline.js";
import {
  emitJitFlagMaterializationPlan,
  emitJitRegisterFoldingPlan,
  planJitFlagMaterialization,
  planJitRegisterFolding
} from "#backends/wasm/jit/optimization/planner/emitter.js";
import { registerWriteInvalidatesFlagProducerInputs } from "#backends/wasm/jit/optimization/planner/policy.js";
import type {
  JitOptimizationPlan,
  JitOptimizationPlanRecord,
  PlannedMaterialization
} from "#backends/wasm/jit/optimization/planner/plan.js";
import type { JitTrackedOptimizationStats } from "#backends/wasm/jit/optimization/planner/stats.js";
import {
  planRegisterInstructionEntry,
  planRegisterOp,
  planRegisterPostInstructionExit
} from "#backends/wasm/jit/optimization/registers/planner.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import { jitTrackedFlagsLocation } from "#backends/wasm/jit/optimization/tracked/state.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";

export type { JitOptimizationPlan } from "#backends/wasm/jit/optimization/planner/plan.js";
export type { JitTrackedOptimizationStats } from "#backends/wasm/jit/optimization/planner/stats.js";

export type JitTrackedOptimizationResult = JitIrOptimizationPipelineResult & Readonly<{
  plan: JitOptimizationPlan;
  tracking: JitTrackedOptimizationStats;
}>;

export function runTrackedJitOptimization(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): JitTrackedOptimizationResult {
  const plan = planJitOptimization(block, analysis);
  const pipeline = runTrackedJitIrOptimizationPipeline(block);

  return {
    ...pipeline,
    plan,
    tracking: plan.stats
  };
}

export function runTrackedJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const initialAnalysis = analyzeJitOptimization(block);
  const flagPlan = planJitFlagMaterialization(block, initialAnalysis);
  const flagMaterialization = emitJitFlagMaterializationPlan(flagPlan);
  const deadLocalValues = pruneDeadJitLocalValues(flagMaterialization.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerPlan = planJitRegisterFolding(
    deadLocalValues.block,
    registerAnalysis
  );
  const registerFolding = emitJitRegisterFoldingPlan(registerPlan);

  return {
    block: registerFolding.block,
    passes: {
      flagMaterialization: flagMaterialization.flags,
      deadLocalValues: deadLocalValues.deadLocalValues,
      registerFolding: registerFolding.folding
    }
  };
}

export function planJitOptimization(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis
): JitOptimizationPlan {
  const flagAnalysis = analyzeJitFlags(block, analysis);
  const directConditionsByLocation = indexDirectFlagConditions(block, flagAnalysis);
  const neededSourceIds = neededPlannedFlagSourceIds(flagAnalysis, directConditionsByLocation);
  const flagSourcesByLocation = indexPlannedFlagSourcesByLocation(flagAnalysis);
  const state = new JitOptimizationState(analysis.context);
  const records: JitOptimizationPlanRecord[] = [];
  let instructionsWalked = 0;
  let opsWalked = 0;
  let flagSourceCount = 0;
  let flagReadCount = 0;
  let sourceClobberCount = 0;
  let registerProducerCount = 0;
  let registerReadCount = 0;
  let registerClobberCount = 0;
  let registerMaterializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while tracking optimization: ${instructionIndex}`);
    }

    instructionsWalked += 1;
    state.beginInstructionValues();
    const instructionEntryOwners = state.tracked.cloneFlagOwners();
    registerMaterializedSetCount += planRegisterInstructionEntry({
      block,
      state,
      instruction,
      instructionIndex
    }, records);

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while tracking optimization: ${instructionIndex}:${opIndex}`);
      }

      opsWalked += 1;

      const preInstructionExitReason = jitPreInstructionExitReasonAt(
        state.context.effects,
        instructionIndex,
        opIndex
      );

      if (preInstructionExitReason !== undefined) {
        flagReadCount += recordFlagRead(
          state,
          records,
          instructionEntryOwners,
          instructionIndex,
          opIndex,
          "preInstructionExit",
          IR_ALU_FLAG_MASK,
          { exitReason: preInstructionExitReason, materializes: true }
        );
      }

      if (jitOpHasPostInstructionExit(state.context.effects, instructionIndex, opIndex)) {
        flagReadCount += recordFlagRead(
          state,
          records,
          undefined,
          instructionIndex,
          opIndex,
          "exit",
          IR_ALU_FLAG_MASK,
          { materializes: true }
        );
        registerMaterializedSetCount += planRegisterPostInstructionExit({
          block,
          state,
          instruction,
          instructionIndex,
          op,
          opIndex
        }, records);
      }

      sourceClobberCount += recordFlagSourceClobberForOp(
        state,
        records,
        instructionIndex,
        opIndex,
        op,
        instruction
      );

      const registerResult = planRegisterOp({
        block,
        state,
        instruction,
        instructionIndex,
        op,
        opIndex
      }, records);

      registerProducerCount += registerResult.producerCount;
      registerReadCount += registerResult.readCount;
      registerClobberCount += registerResult.clobberCount;
      registerMaterializedSetCount += registerResult.materializedSetCount;

      if (registerResult.handled) {
        continue;
      }

      switch (op.op) {
        case "const32":
        case "i32.add":
        case "i32.sub":
        case "i32.xor":
        case "i32.or":
        case "i32.and":
          state.recordOpValue(op, instruction);
          break;
        case "flags.set": {
          const source = plannedFlagSource(flagSourcesByLocation, instructionIndex, opIndex);

          flagSourceCount += 1;
          state.tracked.recordFlagSource(source);
          records.push({
            kind: "producer",
            domain: "flags",
            instructionIndex,
            opIndex,
            location: jitTrackedFlagsLocation(source.writtenMask | source.undefMask),
            producer: { kind: "flagSource", source }
          });
          if (shouldDropFlagProducer(source, neededSourceIds)) {
            records.push({
              kind: "drop",
              domain: "flags",
              instructionIndex,
              opIndex,
              op: "flags.set",
              reason: "unusedProducer"
            });
          } else {
            records.push({
              kind: "materialization",
              domain: "flags",
              instructionIndex,
              opIndex,
              location: jitTrackedFlagsLocation(source.writtenMask | source.undefMask),
              phase: "atOp",
              reason: "materialize"
            });
          }
          break;
        }
        case "aluFlags.condition": {
          const conditionUse = jitConditionUseAt(state.context.effects, instructionIndex, opIndex);

          if (conditionUse !== undefined) {
            const directCondition = directConditionsByLocation.get(instructionIndex)?.get(opIndex);

            flagReadCount += recordFlagRead(
              state,
              records,
              undefined,
              instructionIndex,
              opIndex,
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
                instructionIndex,
                opIndex,
                location: jitTrackedFlagsLocation(directCondition.source.writtenMask | directCondition.source.undefMask),
                foldKind: "flagCondition"
              });
            }
          }
          break;
        }
        case "flags.materialize":
          flagReadCount += recordFlagRead(
            state,
            records,
            undefined,
            instructionIndex,
            opIndex,
            "materialize",
            op.mask,
            { materializes: true }
          );
          state.tracked.recordFlagsMaterialized(op.mask);
          break;
        case "flags.boundary":
          flagReadCount += recordFlagRead(
            state,
            records,
            undefined,
            instructionIndex,
            opIndex,
            "boundary",
            op.mask,
            { materializes: true }
          );
          state.tracked.recordFlagsMaterialized(op.mask);
          break;
        case "next":
        case "jump":
        case "conditionalJump":
        case "hostTrap":
          break;
        default:
          break;
      }
    }
  }

  return {
    block,
    records,
    stats: {
      instructionsWalked,
      opsWalked,
      flagSourceCount,
      flagReadCount,
      sourceClobberCount,
      registerProducerCount,
      registerReadCount,
      registerClobberCount,
      registerMaterializedSetCount
    }
  };
}

function recordFlagRead(
  state: JitOptimizationState,
  records: JitOptimizationPlanRecord[],
  owners: ReturnType<typeof state.tracked.cloneFlagOwners> | undefined,
  instructionIndex: number,
  opIndex: number,
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
    instructionIndex,
    opIndex,
    reason,
    requiredMask,
    ...(options.exitReason === undefined ? {} : { exitReason: options.exitReason }),
    ...(options.cc === undefined ? {} : { cc: options.cc })
  };

  const trackedRead = owners === undefined
    ? state.tracked.recordFlagRead(read)
    : state.tracked.recordFlagRead(read, owners);

  records.push({
    kind: "read",
    domain: "flags",
    instructionIndex,
    opIndex,
    location: trackedRead.location,
    reason: trackedRead.reason,
    read: trackedRead
  });

  if (options.materializes === true) {
    records.push({
      kind: "materialization",
      domain: "flags",
      instructionIndex,
      opIndex,
      location: trackedRead.location,
      phase: flagMaterializationPhase(reason),
      reason
    });
  }

  return 1;
}

function recordFlagSourceClobberForOp(
  state: JitOptimizationState,
  records: JitOptimizationPlanRecord[],
  instructionIndex: number,
  opIndex: number,
  op: JitIrOp,
  instruction: JitIrBlockInstruction
): number {
  switch (op.op) {
    case "set32":
    case "set32.if":
      return recordFlagSourceClobber(
        state,
        records,
        instructionIndex,
        opIndex,
        op.target,
        instruction
      );
    default:
      return 0;
  }
}

function recordFlagSourceClobber(
  state: JitOptimizationState,
  records: JitOptimizationPlanRecord[],
  instructionIndex: number,
  opIndex: number,
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return 0;
  }

  if (!registerWriteInvalidatesFlagProducerInputs(state.tracked, storage, instruction)) {
    return 0;
  }

  records.push({
    kind: "clobber",
    domain: "flags",
    instructionIndex,
    opIndex,
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
