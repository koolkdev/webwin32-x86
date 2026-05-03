import { reg32, type Reg32 } from "#x86/isa/types.js";
import { conditionFlagReadMask, IR_ALU_FLAG_MASK } from "#x86/ir/passes/flag-analysis.js";
import type { IrOp, StorageRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitOperandBinding } from "#backends/wasm/jit/lowering/operand-bindings.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt,
  jitPostInstructionExitReasonsAt,
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import {
  requiredJitOperandBinding
} from "./op-effects.js";
import type {
  JitBlockOptimization,
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitInstructionState,
  JitStateSnapshot
} from "./types.js";

type MutableJitStateTracker = {
  committedRegs: Set<Reg32>;
  speculativeRegs: Set<Reg32>;
  committedFlagsMask: number;
  speculativeFlagsMask: number;
  instructionCountDelta: number;
};

export function analyzeJitBlockState(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Omit<JitBlockOptimization, "block"> {
  const state: MutableJitStateTracker = {
    committedRegs: new Set(),
    speculativeRegs: new Set(),
    committedFlagsMask: IR_ALU_FLAG_MASK,
    speculativeFlagsMask: 0,
    instructionCountDelta: 0
  };
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

    const entry = snapshotState(state, "preInstruction", instruction.eip);
    const exitStart = exitPoints.length;

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while optimizing JIT IR block: ${instructionIndex}:${opIndex}`);
      }

      const faultReason = jitPreInstructionExitReasonAt(analysis, instructionIndex, opIndex);

      if (faultReason !== undefined) {
        recordExitPoint(instructionIndex, opIndex, faultReason, entry);
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

  function instructionPostState(instruction: JitIrBlockInstruction): JitStateSnapshot {
    currentPostState ??= snapshotPostInstruction(state, instruction.nextEip);

    return currentPostState;
  }

  function recordOpEffects(
    op: IrOp,
    instruction: JitIrBlockInstruction,
    instructionIndex: number,
    opIndex: number
  ): void {
    switch (op.op) {
      case "set32":
      case "set32.if":
        recordStorageWriteEffects(op.target, instruction.operands);
        return;
      case "flags.set":
        markSpeculativeFlags(op.writtenMask | op.undefMask);
        return;
      case "flags.boundary":
        commitFlags(op.mask);
        return;
      case "aluFlags.condition": {
        const requiredMask = conditionFlagReadMask(op.cc);
        const pendingMask = requiredMask & state.speculativeFlagsMask;

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

        if (!jitOpHasPostInstructionExit(analysis, instructionIndex, opIndex)) {
          commitInstruction();
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
    instruction: JitIrBlockInstruction,
    instructionIndex: number,
    opIndex: number
  ): void {
    const exitReasons = jitPostInstructionExitReasonsAt(analysis, instructionIndex, opIndex);
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

  function recordStorageWriteEffects(storage: StorageRef, operands: readonly JitOperandBinding[]): void {
    switch (storage.kind) {
      case "reg":
        state.speculativeRegs.add(storage.reg);
        return;
      case "operand": {
        const binding = requiredJitOperandBinding(operands, storage.index);

        if (binding.kind === "static.reg32") {
          state.speculativeRegs.add(binding.reg);
        }
        return;
      }
      case "mem":
        return;
    }
  }

  function markSpeculativeFlags(mask: number): void {
    state.speculativeFlagsMask |= mask;
    state.committedFlagsMask &= ~mask;
  }

  function commitFlags(mask: number): void {
    const committedMask = mask & state.speculativeFlagsMask;

    state.speculativeFlagsMask &= ~mask;
    state.committedFlagsMask |= committedMask;
  }

  function commitInstruction(): void {
    for (const reg of state.speculativeRegs) {
      state.committedRegs.add(reg);
    }

    state.speculativeRegs.clear();
    state.instructionCountDelta += 1;
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

function snapshotPostInstruction(state: MutableJitStateTracker, eip: number): JitStateSnapshot {
  const committedRegs = sortedRegs(new Set([...state.committedRegs, ...state.speculativeRegs]));

  return {
    kind: "postInstruction",
    eip,
    instructionCountDelta: state.instructionCountDelta + 1,
    committedRegs,
    speculativeRegs: [],
    committedFlags: { mask: state.committedFlagsMask },
    speculativeFlags: { mask: state.speculativeFlagsMask }
  };
}

function snapshotState(
  state: MutableJitStateTracker,
  kind: JitExitSnapshotKind,
  eip: number
): JitStateSnapshot {
  const committedRegs = sortedRegs(state.committedRegs);

  return {
    kind,
    eip,
    instructionCountDelta: state.instructionCountDelta,
    committedRegs,
    speculativeRegs: sortedRegs(state.speculativeRegs),
    committedFlags: { mask: state.committedFlagsMask },
    speculativeFlags: { mask: state.speculativeFlagsMask }
  };
}

function sortedRegs(regs: ReadonlySet<Reg32>): readonly Reg32[] {
  return reg32.filter((reg) => regs.has(reg));
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
