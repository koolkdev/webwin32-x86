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
import { shouldRetainRegisterValue } from "#backends/wasm/jit/optimization/registers/policy.js";
import { createJitPreludeRewrite } from "#backends/wasm/jit/optimization/ir/rewrite.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import { jitTrackedRegisterLocation } from "#backends/wasm/jit/optimization/tracked/state.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";

export type JitTrackedOptimizationStats = Readonly<{
  instructionsWalked: number;
  opsWalked: number;
  flagSourceCount: number;
  flagReadCount: number;
  sourceClobberCount: number;
  registerProducerCount: number;
  registerReadCount: number;
  registerClobberCount: number;
  registerMaterializedSetCount: number;
}>;

export type JitTrackedOptimizationResult = JitIrOptimizationPipelineResult & Readonly<{
  tracking: JitTrackedOptimizationStats;
}>;

export function runTrackedJitOptimization(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): JitTrackedOptimizationResult {
  const tracking = trackJitOptimization(block, analysis);
  const pipeline = runTrackedJitIrOptimizationPipeline(block);

  return {
    ...pipeline,
    tracking
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

function trackJitOptimization(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis
): JitTrackedOptimizationStats {
  const state = new JitOptimizationState(analysis.context);
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

    registerMaterializedSetCount += state.tracked.materializeRegistersForPreInstructionExits(
      prelude,
      instructionIndex
    );

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
          undefined,
          instructionIndex,
          opIndex,
          "exit",
          IR_ALU_FLAG_MASK
        );
        registerMaterializedSetCount += state.tracked.materializeRegistersForPostInstructionExit(
          createJitPreludeRewrite(),
          instructionIndex,
          opIndex
        );
      }

      switch (op.op) {
        case "get32":
          registerReadCount += recordStorageRead(state, op.source, instruction);
          state.recordOpValue(op, instruction);
          break;
        case "address32":
          for (const reg of state.tracked.registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
            state.tracked.recordRegisterRead(reg);
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
          sourceClobberCount += recordFlagSourceClobber(state, op.target, instruction);
          registerClobberCount += recordRegisterClobberCount(op.target, instruction);
          registerMaterializedSetCount += recordRegisterClobber(state, op.target, instruction);
          registerProducerCount += recordRegisterProducer(state, op, instruction);
          break;
        case "set32.if":
          sourceClobberCount += recordFlagSourceClobber(state, op.target, instruction);
          registerClobberCount += recordRegisterClobberCount(op.target, instruction);
          registerMaterializedSetCount += recordRegisterClobber(state, op.target, instruction);
          break;
        case "flags.set": {
          const source = buildJitFlagSource(nextSourceId, instructionIndex, opIndex, op, state.values);

          nextSourceId += 1;
          flagSourceCount += 1;
          state.tracked.recordFlagSource(source);
          break;
        }
        case "aluFlags.condition": {
          const conditionUse = jitConditionUseAt(state.context.effects, instructionIndex, opIndex);

          if (conditionUse !== undefined) {
            flagReadCount += recordFlagRead(
              state,
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
    instructionsWalked,
    opsWalked,
    flagSourceCount,
    flagReadCount,
    sourceClobberCount,
    registerProducerCount,
    registerReadCount,
    registerClobberCount,
    registerMaterializedSetCount
  };
}

function recordFlagRead(
  state: JitOptimizationState,
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

  if (owners === undefined) {
    state.tracked.recordFlagRead(read);
  } else {
    state.tracked.recordFlagRead(read, owners);
  }

  return 1;
}

function recordStorageRead(
  state: JitOptimizationState,
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined || !state.tracked.registers.hasStorageValue(storage, instruction.operands)) {
    return 0;
  }

  state.tracked.recordRegisterRead(reg);
  return 1;
}

function recordFlagSourceClobber(
  state: JitOptimizationState,
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return 0;
  }

  return state.tracked.flagProducerOwnersReadingReg(reg).length === 0 ? 0 : 1;
}

function recordRegisterClobber(
  state: JitOptimizationState,
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

  state.tracked.recordClobber(jitTrackedRegisterLocation(reg));
  return materializedSetCount;
}

function recordRegisterClobberCount(
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): number {
  return jitStorageReg(storage, instruction.operands) === undefined ? 0 : 1;
}

function recordRegisterProducer(
  state: JitOptimizationState,
  op: Extract<JitIrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);

  if (reg === undefined || value === undefined || !shouldRetainRegisterValue(value)) {
    return 0;
  }

  state.tracked.recordRegisterValue(reg, value);
  return 1;
}
