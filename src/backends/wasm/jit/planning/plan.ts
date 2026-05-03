import { reg32, type Reg32 } from "#x86/isa/types.js";
import { conditionFlagReadMask, IR_ALU_FLAG_MASK } from "#x86/ir/passes/flag-analysis.js";
import type { IrOp, StorageRef } from "#x86/ir/model/types.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/lowering/operand-bindings.js";

export type JitExitSnapshotKind = "preInstruction" | "postInstruction";

export type JitPlannedFlagState = Readonly<{
  mask: number;
}>;

export type JitPlannedStateSnapshot = Readonly<{
  kind: JitExitSnapshotKind;
  eip: number;
  instructionCountDelta: number;
  committedRegs: readonly Reg32[];
  speculativeRegs: readonly Reg32[];
  committedFlags: JitPlannedFlagState;
  speculativeFlags: JitPlannedFlagState;
}>;

export type JitPlannedExit = Readonly<{
  instructionIndex: number;
  opIndex: number;
  exitReason: ExitReasonValue;
  snapshot: JitPlannedStateSnapshot;
  requiredFlagCommitMask: number;
}>;

export type JitPlannedFlagMaterialization = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reason: "condition" | "exit";
  requiredMask: number;
  pendingMask: number;
}>;

export type JitPlannedInstruction = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
  entry: JitPlannedStateSnapshot;
  exitCount: number;
}>;

export type JitIrBlockPlan = Readonly<{
  instructions: readonly JitPlannedInstruction[];
  exits: readonly JitPlannedExit[];
  flagMaterializations: readonly JitPlannedFlagMaterialization[];
  maxExitGeneration: number;
}>;

type MutablePlanningState = {
  committedRegs: Set<Reg32>;
  speculativeRegs: Set<Reg32>;
  committedFlagsMask: number;
  speculativeFlagsMask: number;
  instructionCountDelta: number;
};

export function planJitIrBlock(block: JitIrBlock): JitIrBlockPlan {
  const state: MutablePlanningState = {
    committedRegs: new Set(),
    speculativeRegs: new Set(),
    committedFlagsMask: IR_ALU_FLAG_MASK,
    speculativeFlagsMask: 0,
    instructionCountDelta: 0
  };
  const plannedInstructions: JitPlannedInstruction[] = [];
  const exits: JitPlannedExit[] = [];
  const flagMaterializations: JitPlannedFlagMaterialization[] = [];

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while planning: ${instructionIndex}`);
    }

    const entry = snapshotState(state, "preInstruction", instruction.eip);
    const exitStart = exits.length;

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while planning: ${instructionIndex}:${opIndex}`);
      }

      const faultReason = memoryFaultReason(op, instruction.operands);

      if (faultReason !== undefined) {
        planExit(instructionIndex, opIndex, faultReason, entry);
      }

      planOp(op, instruction, instructionIndex, opIndex);
    }

    plannedInstructions.push({
      instructionId: instruction.instructionId,
      eip: instruction.eip,
      nextEip: instruction.nextEip,
      nextMode: instruction.nextMode,
      entry,
      exitCount: exits.length - exitStart
    });
  }

  return {
    instructions: plannedInstructions,
    exits,
    flagMaterializations,
    maxExitGeneration: block.instructions.length
  };

  function planOp(
    op: IrOp,
    instruction: JitIrBlockInstruction,
    instructionIndex: number,
    opIndex: number
  ): void {
    switch (op.op) {
      case "set32":
        planStorageWrite(op.target, instruction.operands);
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
          flagMaterializations.push({
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
        if (instruction.nextMode === "exit") {
          planExit(
            instructionIndex,
            opIndex,
            ExitReason.FALLTHROUGH,
            snapshotPostInstruction(state, instruction.nextEip)
          );
        } else {
          commitInstruction();
        }
        return;
      case "jump":
        planExit(instructionIndex, opIndex, ExitReason.JUMP, snapshotPostInstruction(state, instruction.nextEip));
        return;
      case "conditionalJump": {
        const snapshot = snapshotPostInstruction(state, instruction.nextEip);

        planExit(instructionIndex, opIndex, ExitReason.BRANCH_TAKEN, snapshot);
        planExit(instructionIndex, opIndex, ExitReason.BRANCH_NOT_TAKEN, snapshot);
        return;
      }
      case "hostTrap":
        planExit(instructionIndex, opIndex, ExitReason.HOST_TRAP, snapshotPostInstruction(state, instruction.nextEip));
        return;
      default:
        return;
    }
  }

  function planExit(
    instructionIndex: number,
    opIndex: number,
    exitReason: ExitReasonValue,
    snapshot: JitPlannedStateSnapshot
  ): void {
    const requiredFlagCommitMask = snapshot.speculativeFlags.mask;

    exits.push({
      instructionIndex,
      opIndex,
      exitReason,
      snapshot,
      requiredFlagCommitMask
    });

    if (requiredFlagCommitMask !== 0) {
      flagMaterializations.push({
        instructionIndex,
        opIndex,
        reason: "exit",
        requiredMask: requiredFlagCommitMask,
        pendingMask: requiredFlagCommitMask
      });
    }
  }

  function planStorageWrite(storage: StorageRef, operands: readonly JitOperandBinding[]): void {
    switch (storage.kind) {
      case "reg":
        state.speculativeRegs.add(storage.reg);
        return;
      case "operand": {
        const binding = requiredOperand(operands, storage.index);

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
}

function memoryFaultReason(op: IrOp, operands: readonly JitOperandBinding[]): ExitReasonValue | undefined {
  switch (op.op) {
    case "get32":
      return storageMayAccessMemory(op.source, operands) ? ExitReason.MEMORY_READ_FAULT : undefined;
    case "set32":
      return storageMayAccessMemory(op.target, operands) ? ExitReason.MEMORY_WRITE_FAULT : undefined;
    default:
      return undefined;
  }
}

function storageMayAccessMemory(storage: StorageRef, operands: readonly JitOperandBinding[]): boolean {
  switch (storage.kind) {
    case "mem":
      return true;
    case "reg":
      return false;
    case "operand":
      return requiredOperand(operands, storage.index).kind === "static.mem32";
  }
}

function requiredOperand(operands: readonly JitOperandBinding[], index: number): JitOperandBinding {
  const operand = operands[index];

  if (operand === undefined) {
    throw new Error(`missing JIT operand while planning: ${index}`);
  }

  return operand;
}

function snapshotPostInstruction(state: MutablePlanningState, eip: number): JitPlannedStateSnapshot {
  return {
    kind: "postInstruction",
    eip,
    instructionCountDelta: state.instructionCountDelta + 1,
    committedRegs: sortedRegs(new Set([...state.committedRegs, ...state.speculativeRegs])),
    speculativeRegs: [],
    committedFlags: { mask: state.committedFlagsMask },
    speculativeFlags: { mask: state.speculativeFlagsMask }
  };
}

function snapshotState(
  state: MutablePlanningState,
  kind: JitExitSnapshotKind,
  eip: number
): JitPlannedStateSnapshot {
  return {
    kind,
    eip,
    instructionCountDelta: state.instructionCountDelta,
    committedRegs: sortedRegs(state.committedRegs),
    speculativeRegs: sortedRegs(state.speculativeRegs),
    committedFlags: { mask: state.committedFlagsMask },
    speculativeFlags: { mask: state.speculativeFlagsMask }
  };
}

function sortedRegs(regs: ReadonlySet<Reg32>): readonly Reg32[] {
  return reg32.filter((reg) => regs.has(reg));
}
