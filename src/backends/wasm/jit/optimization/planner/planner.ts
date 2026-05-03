import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { pruneDeadJitLocalValues } from "#backends/wasm/jit/optimization/passes/dead-local-values.js";
import {
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt
} from "#backends/wasm/jit/optimization/effects/effects.js";
import { createFlagPlanner } from "#backends/wasm/jit/optimization/flags/planner.js";
import type { JitIrOptimizationPipelineResult } from "#backends/wasm/jit/optimization/pipeline.js";
import { recordJitPlannerFacts } from "#backends/wasm/jit/optimization/planner/decisions.js";
import {
  emitJitFlagMaterializationFromPlan,
  emitJitRegisterFoldingFromPlan
} from "#backends/wasm/jit/optimization/planner/emitter.js";
import type {
  JitOptimizationPlan,
  JitOptimizationPlanRecord
} from "#backends/wasm/jit/optimization/planner/plan.js";
import type { JitTrackedOptimizationStats } from "#backends/wasm/jit/optimization/planner/stats.js";
import {
  planRegisterInstructionEntry,
  planRegisterOp,
  planRegisterPostInstructionExit
} from "#backends/wasm/jit/optimization/registers/planner.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";

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
  const flagPlan = planJitOptimization(block, initialAnalysis);
  const flagMaterialization = emitJitFlagMaterializationFromPlan(flagPlan, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(flagMaterialization.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerPlan = planJitOptimization(
    deadLocalValues.block,
    registerAnalysis
  );
  const registerFolding = emitJitRegisterFoldingFromPlan(registerPlan, registerAnalysis);

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
  const flagPlanner = createFlagPlanner(block, analysis);
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
    const flagInstruction = flagPlanner.beginInstruction({
      block,
      state,
      instruction,
      instructionIndex
    });
    const registerEntry = planRegisterInstructionEntry({
      block,
      state,
      instruction,
      instructionIndex
    });

    recordJitPlannerFacts(records, registerEntry.facts);
    registerMaterializedSetCount += registerEntry.materializedSetCount;

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
        const preInstructionExit = flagPlanner.planPreInstructionExit({
          block,
          state,
          instruction,
          instructionIndex,
          op,
          opIndex
        }, flagInstruction, preInstructionExitReason);

        recordJitPlannerFacts(records, preInstructionExit.facts);
        flagReadCount += preInstructionExit.readCount;
      }

      if (jitOpHasPostInstructionExit(state.context.effects, instructionIndex, opIndex)) {
        const postInstructionExit = flagPlanner.planPostInstructionExit({
          block,
          state,
          instruction,
          instructionIndex,
          op,
          opIndex
        });
        const postInstructionRegisters = planRegisterPostInstructionExit({
          block,
          state,
          instruction,
          instructionIndex,
          op,
          opIndex
        });

        recordJitPlannerFacts(records, postInstructionExit.facts);
        recordJitPlannerFacts(records, postInstructionRegisters.facts);
        flagReadCount += postInstructionExit.readCount;
        registerMaterializedSetCount += postInstructionRegisters.materializedSetCount;
      }

      const sourceClobber = flagPlanner.planSourceClobberForOp({
        block,
        state,
        instruction,
        instructionIndex,
        op,
        opIndex
      });

      recordJitPlannerFacts(records, sourceClobber.facts);
      sourceClobberCount += sourceClobber.sourceClobberCount;

      const registerResult = planRegisterOp({
        block,
        state,
        instruction,
        instructionIndex,
        op,
        opIndex
      });

      recordJitPlannerFacts(records, registerResult.facts);
      registerProducerCount += registerResult.producerCount;
      registerReadCount += registerResult.readCount;
      registerClobberCount += registerResult.clobberCount;
      registerMaterializedSetCount += registerResult.materializedSetCount;

      if (registerResult.handled) {
        continue;
      }

      const flagResult = flagPlanner.planOp({
        block,
        state,
        instruction,
        instructionIndex,
        op,
        opIndex
      });

      recordJitPlannerFacts(records, flagResult.facts);
      flagSourceCount += flagResult.sourceCount;
      flagReadCount += flagResult.readCount;

      if (flagResult.handled) {
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
