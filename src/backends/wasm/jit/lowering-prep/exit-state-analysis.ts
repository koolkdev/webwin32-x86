import type { Reg32 } from "#x86/isa/types.js";
import { conditionFlagReadMask } from "#x86/ir/model/flag-effects.js";
import { jitIrOpStorageWrites } from "#backends/wasm/jit/ir-semantics.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrOp, JitOptimizedIrBlock, JitOptimizedIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { JitBlockStateTracker } from "#backends/wasm/jit/lowering-prep/block-state-tracker.js";
import {
  indexJitEffects,
  type JitEffectIndex,
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt,
  jitPostInstructionExitReasonsAt
} from "#backends/wasm/jit/ir/effects.js";
import type {
  JitBlockOptimization,
  JitExitPoint,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitInstructionState,
  JitStateSnapshot
} from "#backends/wasm/jit/lowering-prep/types.js";

export function analyzeJitBlockState(
  block: JitOptimizedIrBlock,
  effects: JitEffectIndex = indexJitEffects(block)
): Omit<JitBlockOptimization, "block"> {
  const state = new JitBlockStateTracker();
  const instructionStates: JitInstructionState[] = [];
  const exitPoints: JitExitPoint[] = [];
  const flagMaterializationRequirements: JitFlagMaterializationRequirement[] = [];
  const exitStates: JitExitState[] = [{ regs: [] }];
  const exitStateIndexByKey = new Map<string, number>([[exitStateKey([]), 0]]);
  let currentPostState: JitStateSnapshot | undefined;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];
    currentPostState = undefined;

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while optimizing JIT IR block: ${instructionIndex}`);
    }

    for (let opIndex = 0; opIndex < instruction.prelude.length; opIndex += 1) {
      const op = instruction.prelude[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT prelude op while optimizing JIT IR block: ${instructionIndex}:${opIndex}`);
      }

      recordPreludeOpEffects(op, instruction);
    }

    const entry = state.snapshot("preInstruction", instruction.eip);
    const exitStart = exitPoints.length;

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while optimizing JIT IR block: ${instructionIndex}:${opIndex}`);
      }

      const faultReason = jitPreInstructionExitReasonAt(effects, instructionIndex, opIndex);

      if (faultReason !== undefined) {
        recordExitPoint(
          instructionIndex,
          opIndex,
          faultReason,
          preInstructionFaultSnapshot(entry, state.snapshot("preInstruction", instruction.eip))
        );
      }

      recordOpEffects(op, instruction, instructionIndex, opIndex);
    }

    if (currentPostState === undefined) {
      throw new Error(`missing JIT instruction terminator while optimizing JIT IR block: ${instructionIndex}`);
    }

    instructionStates.push({
      instructionId: instruction.instructionId,
      eip: instruction.eip,
      nextEip: instruction.nextEip,
      nextMode: instruction.nextMode,
      preInstructionState: entry,
      postInstructionState: currentPostState,
      preInstructionExitPointCount: preInstructionExitPointCount(exitPoints, exitStart),
      exitPointCount: exitPoints.length - exitStart
    });
  }

  return {
    instructionStates,
    exitPoints,
    flagMaterializationRequirements,
    exitStates,
    maxExitStateIndex: exitStates.length - 1
  };

  function instructionPostState(instruction: JitOptimizedIrBlockInstruction): JitStateSnapshot {
    currentPostState ??= state.snapshotPostInstruction(instruction.nextEip);

    return currentPostState;
  }

  function recordPreludeOpEffects(
    op: JitIrOp,
    instruction: JitOptimizedIrBlockInstruction
  ): void {
    for (const storage of jitIrOpStorageWrites(op)) {
      state.recordCommittedStorageWrite(storage, instruction.operands);
    }
  }

  function recordOpEffects(
    op: JitIrOp,
    instruction: JitOptimizedIrBlockInstruction,
    instructionIndex: number,
    opIndex: number
  ): void {
    switch (op.op) {
      case "set32":
        if (op.jitRole === "registerMaterialization") {
          state.recordCommittedStorageWrite(op.target, instruction.operands);
          return;
        }

        state.recordStorageWrite(op.target, instruction.operands);
        return;
      case "set32.if":
        state.recordStorageWrite(op.target, instruction.operands);
        return;
      case "flags.set":
        state.markSpeculativeFlags(op.writtenMask | op.undefMask);
        return;
      case "flags.boundary":
        state.commitFlags(op.mask);
        return;
      case "aluFlags.condition": {
        const requiredMask = conditionFlagReadMask(op.cc);
        const pendingMask = state.pendingFlags(requiredMask);

        if (requiredMask !== 0) {
          flagMaterializationRequirements.push({
            instructionIndex,
            opIndex,
            reason: "condition",
            requiredMask,
            pendingMask
          });
        }
        return;
      }
      case "next":
        recordPostInstructionExits(instruction, instructionIndex, opIndex);

        if (!jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
          state.commitInstruction();
        }
        return;
      case "jump":
      case "conditionalJump":
      case "hostTrap":
        recordPostInstructionExits(instruction, instructionIndex, opIndex);
        return;
      default:
        return;
    }
  }

  function recordPostInstructionExits(
    instruction: JitOptimizedIrBlockInstruction,
    instructionIndex: number,
    opIndex: number
  ): void {
    const exitReasons = jitPostInstructionExitReasonsAt(effects, instructionIndex, opIndex);
    const snapshot = instructionPostState(instruction);

    for (const exitReason of exitReasons) {
      recordExitPoint(instructionIndex, opIndex, exitReason, snapshot);
    }
  }

  function recordExitPoint(
    instructionIndex: number,
    opIndex: number,
    exitReason: ExitReasonValue,
    snapshot: JitStateSnapshot
  ): void {
    const requiredFlagCommitMask = snapshot.speculativeFlags.mask;
    const exitStateIndex = internExitState(snapshot.committedRegs);

    exitPoints.push({
      instructionIndex,
      opIndex,
      exitReason,
      snapshot,
      exitStateIndex,
      requiredFlagCommitMask
    });

    if (requiredFlagCommitMask !== 0) {
      flagMaterializationRequirements.push({
        instructionIndex,
        opIndex,
        reason: "exit",
        requiredMask: requiredFlagCommitMask,
        pendingMask: requiredFlagCommitMask
      });
    }
  }

  function internExitState(regs: readonly Reg32[]): number {
    const key = exitStateKey(regs);
    const existingIndex = exitStateIndexByKey.get(key);

    if (existingIndex !== undefined) {
      return existingIndex;
    }

    const index = exitStates.length;

    exitStates.push({ regs });
    exitStateIndexByKey.set(key, index);
    return index;
  }
}

function preInstructionFaultSnapshot(
  entry: JitStateSnapshot,
  current: JitStateSnapshot
): JitStateSnapshot {
  return {
    ...entry,
    committedRegs: current.committedRegs,
    committedFlags: current.committedFlags
  };
}

function preInstructionExitPointCount(exitPoints: readonly JitExitPoint[], exitStart: number): number {
  let count = 0;

  for (let index = exitStart; index < exitPoints.length; index += 1) {
    const exitPoint = exitPoints[index];

    if (exitPoint?.snapshot.kind === "preInstruction") {
      count += 1;
    }
  }

  return count;
}

function exitStateKey(regs: readonly Reg32[]): string {
  return regs.join(",");
}
