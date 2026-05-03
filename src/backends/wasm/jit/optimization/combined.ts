import { conditionFlagReadMask, IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { toJitOptimizedIrPreludeOp } from "#backends/wasm/jit/prelude.js";
import type {
  JitIrBlock,
  JitIrBlockInstruction,
  JitIrOp,
  JitOptimizedIrBlock,
  JitOptimizedIrBlockInstruction
} from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import { pruneDeadJitLocalValues } from "./dead-local-values.js";
import {
  jitConditionUseAt,
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt
} from "./effects.js";
import {
  emitDirectFlagCondition,
  indexDirectFlagConditions,
  type JitDirectFlagConditionIndex
} from "./flag-condition-planning.js";
import {
  analyzeJitFlags,
  type JitFlagAnalysis,
  type JitFlagMaterialization
} from "./flags.js";
import {
  buildJitFlagSource,
  type JitFlagSource
} from "./flag-sources.js";
import type { JitIrOptimizationPipelineResult } from "./pipeline.js";
import {
  firstRegisterFoldableOpIndex,
  recordCopiedRegisterOp
} from "./register-folding-prefix.js";
import type { JitRegisterFolding } from "./register-folding.js";
import {
  materializeRegisterValuesForPostInstructionExit,
  materializeRegisterValuesForPreInstructionExits
} from "./register-materialization.js";
import { shouldRetainRegisterValue } from "./register-policy.js";
import {
  createJitPreludeRewrite,
  rewriteJitIrInstruction,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "./rewrite.js";
import {
  rewriteRegisterAddress32,
  rewriteRegisterGet32,
  rewriteRegisterSet32,
  rewriteRegisterSet32If,
  unchangedJitRegisterRewriteResult,
  type JitRegisterRewriteResult
} from "./register-rewrite.js";
import { JitOptimizationState } from "./state.js";
import { jitTrackedRegisterLocation } from "./tracked-state.js";
import { jitStorageReg } from "./values.js";

export type JitDraftCombinedTracking = Readonly<{
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

export type JitDraftCombinedOptimizationResult = JitIrOptimizationPipelineResult & Readonly<{
  combinedTracking: JitDraftCombinedTracking;
}>;

export function runDraftCombinedJitOptimization(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): JitDraftCombinedOptimizationResult {
  const combinedTracking = trackDraftCombinedOptimization(block, analysis);
  const pipeline = runMergedJitIrOptimizationPipeline(block);

  return {
    ...pipeline,
    combinedTracking
  };
}

export function runMergedJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const initialAnalysis = analyzeJitOptimization(block);
  const flagMaterialization = materializeFlagsForMergedPipeline(block, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(flagMaterialization.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerFolding = foldRegistersForMergedPipeline(
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

function materializeFlagsForMergedPipeline(
  block: JitIrBlock,
  optimizationAnalysis: JitOptimizationAnalysis
): Readonly<{ block: JitIrBlock; flags: JitFlagMaterialization }> {
  const flagAnalysis = analyzeJitFlags(block, optimizationAnalysis);
  const directConditionsByLocation = indexDirectFlagConditions(block, flagAnalysis);
  const neededSourceIds = neededMergedFlagSourceIds(flagAnalysis, directConditionsByLocation);
  const sourcesByLocation = indexMergedFlagSourcesByLocation(flagAnalysis);
  const instructions = new Array<JitIrBlockInstruction>(block.instructions.length);
  let removedSetCount = 0;
  let retainedSetCount = 0;
  let directConditionCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while merged-materializing flags: ${instructionIndex}`);
    }

    instructions[instructionIndex] = rewriteJitIrInstruction(
      instruction,
      instructionIndex,
      "merged-materializing flags",
      ({ op, opIndex, rewrite }) => {
        const source = sourcesByLocation.get(instructionIndex)?.get(opIndex);
        const directCondition = directConditionsByLocation.get(instructionIndex)?.get(opIndex);

        if (op.op === "flags.set" && (source === undefined || !neededSourceIds.has(source.id))) {
          removedSetCount += 1;
        } else if (op.op === "aluFlags.condition" && directCondition !== undefined) {
          emitDirectFlagCondition(rewrite, op, directCondition);
          directConditionCount += 1;
        } else {
          if (op.op === "flags.set") {
            retainedSetCount += 1;
          }

          rewrite.ops.push(op);
        }
      }
    );
  }

  return {
    block: { instructions },
    flags: {
      removedSetCount,
      retainedSetCount,
      directConditionCount,
      sourceClobberCount: flagAnalysis.sourceClobbers.length
    }
  };
}

function foldRegistersForMergedPipeline(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis
): Readonly<{ block: JitOptimizedIrBlock; folding: JitRegisterFolding }> {
  const state = new JitOptimizationState(analysis.context);
  const instructions: JitOptimizedIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let materializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while merged-folding register values: ${instructionIndex}`);
    }

    const prelude = createJitPreludeRewrite();

    materializedSetCount += materializeRegisterValuesForPreInstructionExits(
      prelude,
      instructionIndex,
      state
    );

    const rewrite = state.beginInstructionRewrite(instruction);
    const firstFoldableOpIndex = firstRegisterFoldableOpIndex(instructionIndex, state);

    rewriteJitIrInstructionInto(
      instruction,
      instructionIndex,
      "merged-folding register values",
      rewrite,
      ({ op, opIndex }) => {
        if (opIndex < firstFoldableOpIndex) {
          recordCopiedRegisterOp(op, instruction, rewrite);
          rewrite.ops.push(op);
          return;
        }

        const result = rewriteMergedRegisterOp(
          op,
          instruction,
          instructionIndex,
          opIndex,
          rewrite,
          state
        );

        if (result.removedSet) {
          removedSetCount += 1;
        }

        materializedSetCount += result.materializedSetCount;
      }
    );

    instructions.push({
      ...instruction,
      prelude: prelude.ops.map(toJitOptimizedIrPreludeOp),
      ir: rewrite.ops
    });
  }

  if (state.tracked.registers.size !== 0) {
    throw new Error("JIT register values were not materialized before merged block end");
  }

  return {
    block: { instructions },
    folding: { removedSetCount, materializedSetCount }
  };
}

function rewriteMergedRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteRegisterGet32(op, instruction, rewrite, state);
    case "const32":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
    case "address32":
      return rewriteRegisterAddress32(op, instruction, rewrite, state);
    case "set32":
      return rewriteRegisterSet32(op, instruction, rewrite, state);
    case "set32.if":
      return rewriteRegisterSet32If(op, instruction, rewrite, state);
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const materializedSetCount = materializeRegisterValuesForPostInstructionExit(
        rewrite,
        instructionIndex,
        opIndex,
        state
      );

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
  }
}

function neededMergedFlagSourceIds(
  analysis: JitFlagAnalysis,
  directConditionsByLocation: JitDirectFlagConditionIndex
): ReadonlySet<number> {
  const neededSourceIds = new Set<number>();

  for (const read of analysis.reads) {
    if (directConditionsByLocation.get(read.instructionIndex)?.has(read.opIndex) === true) {
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

function indexMergedFlagSourcesByLocation(
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

function trackDraftCombinedOptimization(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis
): JitDraftCombinedTracking {
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
      throw new Error(`missing JIT instruction while draft-combining optimization: ${instructionIndex}`);
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
        throw new Error(`missing JIT IR op while draft-combining optimization: ${instructionIndex}:${opIndex}`);
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
