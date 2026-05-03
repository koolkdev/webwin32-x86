import type { Reg32 } from "#x86/isa/types.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  indexJitEffects,
  jitPreInstructionExitReasonAt,
  jitPostInstructionExitReasonsAt,
  jitOpHasPostInstructionExit
} from "#backends/wasm/jit/ir/effects.js";
import { jitStorageReg } from "#backends/wasm/jit/ir/values.js";

export type JitBarrierReason =
  | "preInstructionExit"
  | "exit"
  | "write"
  | "conditionalWrite";

export type JitBarrier = Readonly<{
  instructionIndex: number;
  opIndex?: number;
  reason: JitBarrierReason;
  exitReason?: ExitReasonValue;
  exitReasons?: readonly ExitReasonValue[];
  reg?: Reg32;
}>;

export type JitBarrierAnalysis = Readonly<{
  barriers: readonly JitBarrier[];
}>;

export type JitRegisterBarrierReason = JitBarrierReason;
export type JitRegisterBarrier = JitBarrier;
export type JitRegisterBarrierAnalysis = JitBarrierAnalysis;

export function analyzeJitBarriers(block: JitIrBlock): JitBarrierAnalysis {
  const effects = indexJitEffects(block);
  const barriers: JitBarrier[] = [];

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing register barriers: ${instructionIndex}`);
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing register barriers: ${instructionIndex}:${opIndex}`);
      }

      const preInstructionExitReason = jitPreInstructionExitReasonAt(effects, instructionIndex, opIndex);

      if (preInstructionExitReason !== undefined) {
        barriers.push({
          instructionIndex,
          opIndex,
          reason: "preInstructionExit",
          exitReason: preInstructionExitReason
        });
      }

      if (op.op === "set32") {
        pushRegisterWriteBarrier(barriers, instruction, instructionIndex, opIndex, op.target, "write");
      } else if (op.op === "set32.if") {
        pushRegisterWriteBarrier(barriers, instruction, instructionIndex, opIndex, op.target, "conditionalWrite");
      }

      if (jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
        barriers.push({
          instructionIndex,
          opIndex,
          reason: "exit",
          exitReasons: jitPostInstructionExitReasonsAt(effects, instructionIndex, opIndex)
        });
      }
    }
  }

  return { barriers };
}

export const analyzeJitRegisterBarriers = analyzeJitBarriers;

export function jitInstructionHasBarrier(
  analysis: JitBarrierAnalysis,
  instructionIndex: number,
  reason: JitBarrierReason
): boolean {
  return analysis.barriers.some((barrier) =>
    barrier.instructionIndex === instructionIndex &&
    barrier.reason === reason
  );
}

export function jitOpBarriersAt(
  analysis: JitBarrierAnalysis,
  instructionIndex: number,
  opIndex: number
): readonly JitBarrier[] {
  return analysis.barriers.filter((barrier) =>
    barrier.instructionIndex === instructionIndex &&
    barrier.opIndex === opIndex
  );
}

export function jitOpHasBarrier(
  analysis: JitBarrierAnalysis,
  instructionIndex: number,
  opIndex: number,
  reason: JitBarrierReason
): boolean {
  return jitOpBarriersAt(analysis, instructionIndex, opIndex).some((barrier) => barrier.reason === reason);
}

export function jitOpPreInstructionExitReasonAt(
  analysis: JitBarrierAnalysis,
  instructionIndex: number,
  opIndex: number
): ExitReasonValue | undefined {
  return jitOpBarriersAt(analysis, instructionIndex, opIndex)
    .find((barrier) => barrier.reason === "preInstructionExit")
    ?.exitReason;
}

function pushRegisterWriteBarrier(
  barriers: JitBarrier[],
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  storage: StorageRef,
  reason: "write" | "conditionalWrite"
): void {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg !== undefined) {
    barriers.push({ instructionIndex, opIndex, reason, reg });
  }
}
