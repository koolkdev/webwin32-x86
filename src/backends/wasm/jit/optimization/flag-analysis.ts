import type { Reg32 } from "#x86/isa/types.js";
import {
  conditionFlagReadMask,
  IR_ALU_FLAG_MASK
} from "#x86/ir/model/flag-effects.js";
import type {
  ConditionCode,
  StorageRef
} from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import {
  jitConditionUseAt,
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt
} from "./effects.js";
import {
  JitFlagOwners,
  type JitFlagOwner,
  type JitFlagOwnerMask
} from "./flag-owners.js";
import type { JitConditionUse } from "./condition-uses.js";
import {
  jitStorageReg
} from "./values.js";
import { JitValueTracker } from "./value-tracker.js";
import {
  buildJitFlagSource,
  type JitFlagInput,
  type JitFlagSource
} from "./flag-sources.js";
import { JitOptimizationState } from "./state.js";
import type {
  JitTrackedProducer,
  JitTrackedRead
} from "./tracked-state.js";

export type {
  JitFlagOwner,
  JitFlagOwnerMask
} from "./flag-owners.js";

export type {
  JitFlagInput,
  JitFlagSource
} from "./flag-sources.js";

export type JitFlagRead = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reason: "condition" | "materialize" | "boundary" | "preInstructionExit" | "exit";
  requiredMask: number;
  exitReason?: ExitReasonValue;
  cc?: ConditionCode;
  conditionUse?: JitConditionUse;
  owners: readonly JitFlagOwnerMask[];
}>;

export type JitFlagSourceClobber = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reg: Reg32;
  owners: readonly JitFlagOwnerMask[];
}>;

export type JitFlagAnalysis = Readonly<{
  sources: readonly JitFlagSource[];
  reads: readonly JitFlagRead[];
  sourceClobbers: readonly JitFlagSourceClobber[];
  finalOwners: readonly JitFlagOwnerMask[];
}>;

export function analyzeJitFlags(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): JitFlagAnalysis {
  const state = new JitOptimizationState(analysis.context);
  const sources: JitFlagSource[] = [];
  const reads: JitFlagRead[] = [];
  const sourceClobbers: JitFlagSourceClobber[] = [];
  let nextSourceId = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing flags: ${instructionIndex}`);
    }

    const values = state.beginInstructionValues();
    const instructionEntryOwners = state.tracked.cloneFlagOwners();

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing flags: ${instructionIndex}:${opIndex}`);
      }

      analyzeOp(instructionIndex, opIndex, instruction, op, values, instructionEntryOwners);
    }
  }

  return {
    sources,
    reads,
    sourceClobbers,
    finalOwners: state.tracked.flagOwnersForMask(IR_ALU_FLAG_MASK)
  };

  function analyzeOp(
    instructionIndex: number,
    opIndex: number,
    instruction: JitIrBlockInstruction,
    op: JitIrOp,
    values: JitValueTracker,
    instructionEntryOwners: JitFlagOwners
  ): void {
    const preInstructionExitReason = jitPreInstructionExitReasonAt(state.context.effects, instructionIndex, opIndex);

    if (preInstructionExitReason !== undefined) {
      recordRead({
        instructionIndex,
        opIndex,
        reason: "preInstructionExit",
        exitReason: preInstructionExitReason,
        requiredMask: IR_ALU_FLAG_MASK
      }, instructionEntryOwners);
    }

    if (jitOpHasPostInstructionExit(state.context.effects, instructionIndex, opIndex)) {
      recordRead({ instructionIndex, opIndex, reason: "exit", requiredMask: IR_ALU_FLAG_MASK });
    }

    if (values.recordOp(op, instruction)) {
      return;
    }

    switch (op.op) {
      case "set32":
      case "set32.if":
        recordSourceClobber(instructionIndex, opIndex, op.target, instruction);
        return;
      case "flags.set":
        recordFlagSource(instructionIndex, opIndex, op, values);
        return;
      case "aluFlags.condition": {
        const conditionUse = jitConditionUseAt(state.context.effects, instructionIndex, opIndex);

        if (conditionUse === undefined) {
          return;
        }

        recordRead({
          instructionIndex,
          opIndex,
          reason: "condition",
          requiredMask: conditionFlagReadMask(op.cc),
          cc: op.cc,
          conditionUse
        });
        return;
      }
      case "flags.materialize":
        recordRead({ instructionIndex, opIndex, reason: "materialize", requiredMask: op.mask });
        state.tracked.recordFlagsMaterialized(op.mask);
        return;
      case "flags.boundary":
        recordRead({ instructionIndex, opIndex, reason: "boundary", requiredMask: op.mask });
        state.tracked.recordFlagsMaterialized(op.mask);
        return;
      case "next":
      case "jump":
      case "conditionalJump":
      case "hostTrap":
        return;
      default:
        return;
    }
  }

  function recordFlagSource(
    instructionIndex: number,
    opIndex: number,
    op: Extract<JitIrOp, { op: "flags.set" }>,
    values: JitValueTracker
  ): void {
    const source = buildJitFlagSource(nextSourceId, instructionIndex, opIndex, op, values);

    nextSourceId += 1;
    sources.push(source);
    state.tracked.recordFlagSource(source);
  }

  function recordRead(
    read: Omit<JitFlagRead, "owners">,
    readOwners?: JitFlagOwners
  ): void {
    if (read.requiredMask === 0) {
      return;
    }

    const trackedRead = readOwners === undefined
      ? state.tracked.recordFlagRead(read)
      : state.tracked.recordFlagRead(read, readOwners);

    reads.push({
      ...read,
      owners: trackedFlagReadOwners(trackedRead)
    });
  }

  function recordSourceClobber(
    instructionIndex: number,
    opIndex: number,
    storage: StorageRef,
    instruction: JitIrBlockInstruction
  ): void {
    const reg = jitStorageReg(storage, instruction.operands);

    if (reg === undefined) {
      return;
    }

    const clobberedOwners = state.tracked.flagProducerOwnersReadingReg(reg);

    if (clobberedOwners.length === 0) {
      return;
    }

    sourceClobbers.push({ instructionIndex, opIndex, reg, owners: clobberedOwners });
  }
}

function trackedFlagReadOwners(read: JitTrackedRead): readonly JitFlagOwnerMask[] {
  return read.producers.map(({ location, producer }) => {
    if (location.kind !== "flags") {
      throw new Error("tracked flag read included a non-flag producer location");
    }

    return {
      mask: location.mask,
      owner: trackedFlagProducerOwner(producer)
    };
  });
}

function trackedFlagProducerOwner(producer: JitTrackedProducer): JitFlagOwner {
  switch (producer.kind) {
    case "incomingFlags":
      return { kind: "incoming" };
    case "materializedFlags":
      return { kind: "materialized" };
    case "flagSource":
      return { kind: "producer", source: producer.source };
    case "registerValue":
      throw new Error("tracked flag read included a register producer");
  }
}
