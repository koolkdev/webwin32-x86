import { conditionFlagReadMask, IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import type { StorageRef } from "#x86/ir/model/types.js";
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
import { buildJitFlagSource } from "#backends/wasm/jit/optimization/flags/sources.js";
import type { JitIrOptimizationPipelineResult } from "#backends/wasm/jit/optimization/pipeline.js";
import {
  emitJitFlagMaterialization,
  emitJitRegisterFolding
} from "#backends/wasm/jit/optimization/planner/emitter.js";
import { registerWriteInvalidatesFlagProducerInputs } from "#backends/wasm/jit/optimization/planner/policy.js";
import type {
  JitOptimizationPlan,
  JitOptimizationPlanRecord
} from "#backends/wasm/jit/optimization/planner/plan.js";
import type { JitTrackedOptimizationStats } from "#backends/wasm/jit/optimization/planner/stats.js";
import { shouldRetainRegisterValue } from "#backends/wasm/jit/optimization/registers/policy.js";
import { createJitPreludeRewrite } from "#backends/wasm/jit/optimization/ir/rewrite.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import {
  jitTrackedFlagsLocation,
  jitTrackedRegisterLocation
} from "#backends/wasm/jit/optimization/tracked/state.js";
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
  const flagMaterialization = emitJitFlagMaterialization(block, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(flagMaterialization.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerFolding = emitJitRegisterFolding(
    deadLocalValues.block,
    registerAnalysis
  );

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
  let nextSourceId = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while tracking optimization: ${instructionIndex}`);
    }

    instructionsWalked += 1;
    state.beginInstructionValues();
    const instructionEntryOwners = state.tracked.cloneFlagOwners();
    const prelude = createJitPreludeRewrite();

    const preInstructionMaterializedSetCount = state.tracked.materializeRegistersForPreInstructionExits(
      prelude,
      instructionIndex
    );
    registerMaterializedSetCount += preInstructionMaterializedSetCount;

    if (preInstructionMaterializedSetCount > 0) {
      records.push({
        kind: "materialization",
        domain: "registers",
        instructionIndex,
        reason: "preInstructionExit",
        count: preInstructionMaterializedSetCount
      });
    }

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
          preInstructionExitReason
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
          IR_ALU_FLAG_MASK
        );
        const postInstructionMaterializedSetCount = state.tracked.materializeRegistersForPostInstructionExit(
          createJitPreludeRewrite(),
          instructionIndex,
          opIndex
        );
        registerMaterializedSetCount += postInstructionMaterializedSetCount;

        if (postInstructionMaterializedSetCount > 0) {
          records.push({
            kind: "materialization",
            domain: "registers",
            instructionIndex,
            opIndex,
            reason: "exit",
            count: postInstructionMaterializedSetCount
          });
        }
      }

      switch (op.op) {
        case "get32":
          registerReadCount += recordStorageRead(state, records, op.source, instruction);
          state.recordOpValue(op, instruction);
          break;
        case "address32":
          for (const reg of state.tracked.registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
            const read = state.tracked.recordRegisterRead(reg);
            records.push({
              kind: "read",
              domain: "registers",
              instructionIndex,
              opIndex,
              read
            });
            registerReadCount += 1;
          }
          state.recordOpValue(op, instruction);
          break;
        case "const32":
        case "i32.add":
        case "i32.sub":
        case "i32.xor":
        case "i32.or":
        case "i32.and":
          state.recordOpValue(op, instruction);
          break;
        case "set32":
          sourceClobberCount += recordFlagSourceClobber(state, records, instructionIndex, opIndex, op.target, instruction);
          registerClobberCount += recordRegisterClobberCount(records, instructionIndex, opIndex, op.target, instruction);
          registerMaterializedSetCount += recordRegisterClobber(state, records, instructionIndex, opIndex, op.target, instruction);
          registerProducerCount += recordRegisterProducer(state, records, instructionIndex, opIndex, op, instruction);
          break;
        case "set32.if":
          sourceClobberCount += recordFlagSourceClobber(state, records, instructionIndex, opIndex, op.target, instruction);
          registerClobberCount += recordRegisterClobberCount(records, instructionIndex, opIndex, op.target, instruction);
          registerMaterializedSetCount += recordRegisterClobber(state, records, instructionIndex, opIndex, op.target, instruction);
          break;
        case "flags.set": {
          const source = buildJitFlagSource(nextSourceId, instructionIndex, opIndex, op, state.values);

          nextSourceId += 1;
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
          break;
        }
        case "aluFlags.condition": {
          const conditionUse = jitConditionUseAt(state.context.effects, instructionIndex, opIndex);

          if (conditionUse !== undefined) {
            flagReadCount += recordFlagRead(
              state,
              records,
              undefined,
              instructionIndex,
              opIndex,
              "condition",
              conditionFlagReadMask(op.cc)
            );
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
            op.mask
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
            op.mask
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
  exitReason?: ExitReasonValue
): number {
  if (requiredMask === 0) {
    return 0;
  }

  const read = {
    instructionIndex,
    opIndex,
    reason,
    requiredMask,
    ...(exitReason === undefined ? {} : { exitReason })
  };

  const trackedRead = owners === undefined
    ? state.tracked.recordFlagRead(read)
    : state.tracked.recordFlagRead(read, owners);

  records.push({
    kind: "read",
    domain: "flags",
    instructionIndex,
    opIndex,
    read: trackedRead
  });

  return 1;
}

function recordStorageRead(
  state: JitOptimizationState,
  records: JitOptimizationPlanRecord[],
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined || !state.tracked.registers.hasStorageValue(storage, instruction.operands)) {
    return 0;
  }

  const read = state.tracked.recordRegisterRead(reg);

  records.push({
    kind: "read",
    domain: "registers",
    read
  });
  return 1;
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
    reg
  });
  return 1;
}

function recordRegisterClobber(
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

  const rewrite = createJitPreludeRewrite();
  const materializedSetCount = state.tracked.materializeRequiredLocations(rewrite, {
    kind: "registerDependencies",
    reason: "clobber",
    reg
  });

  const location = jitTrackedRegisterLocation(reg);

  if (materializedSetCount > 0) {
    records.push({
      kind: "materialization",
      domain: "registers",
      instructionIndex,
      opIndex,
      reason: "clobber",
      location,
      count: materializedSetCount
    });
  }

  state.tracked.recordClobber(location);
  return materializedSetCount;
}

function recordRegisterClobberCount(
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

  records.push({
    kind: "clobber",
    domain: "registers",
    instructionIndex,
    opIndex,
    location: jitTrackedRegisterLocation(reg),
    reg
  });
  return 1;
}

function recordRegisterProducer(
  state: JitOptimizationState,
  records: JitOptimizationPlanRecord[],
  instructionIndex: number,
  opIndex: number,
  op: Extract<JitIrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);

  if (reg === undefined || value === undefined || !shouldRetainRegisterValue(value)) {
    return 0;
  }

  const location = jitTrackedRegisterLocation(reg);

  state.tracked.recordRegisterValue(reg, value);
  records.push({
    kind: "producer",
    domain: "registers",
    instructionIndex,
    opIndex,
    location,
    producer: { kind: "registerValue", value }
  });
  return 1;
}
