import type { Reg32 } from "#x86/isa/types.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  indexJitEffects,
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "#backends/wasm/jit/ir/effects.js";
import { jitStorageReg } from "#backends/wasm/jit/ir/values.js";

export type JitRegisterBarrierReason =
  | "preInstructionExit"
  | "exit"
  | "write"
  | "conditionalWrite";

export type JitRegisterBarrier = Readonly<{
  instructionIndex: number;
  opIndex?: number;
  reason: JitRegisterBarrierReason;
  reg?: Reg32;
}>;

export type JitRegisterBarrierAnalysis = Readonly<{
  barriers: readonly JitRegisterBarrier[];
}>;

export function analyzeJitRegisterBarriers(block: JitIrBlock): JitRegisterBarrierAnalysis {
  const effects = indexJitEffects(block);
  const barriers: JitRegisterBarrier[] = [];

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing register barriers: ${instructionIndex}`);
    }

    if (jitInstructionHasPreInstructionExit(effects, instructionIndex)) {
      barriers.push({ instructionIndex, reason: "preInstructionExit" });
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing register barriers: ${instructionIndex}:${opIndex}`);
      }

      if (op.op === "set32") {
        pushRegisterWriteBarrier(barriers, instruction, instructionIndex, opIndex, op.target, "write");
      } else if (op.op === "set32.if") {
        pushRegisterWriteBarrier(barriers, instruction, instructionIndex, opIndex, op.target, "conditionalWrite");
      }

      if (jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
        barriers.push({ instructionIndex, opIndex, reason: "exit" });
      }
    }
  }

  return { barriers };
}

function pushRegisterWriteBarrier(
  barriers: JitRegisterBarrier[],
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
