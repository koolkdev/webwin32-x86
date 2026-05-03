import {
  IR_ALU_FLAG_MASK,
  IR_FLAG_MASK_NONE,
  irOpFlagEffect
} from "#x86/ir/passes/flag-analysis.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { analyzeJitVirtualFlags } from "./virtual-flag-analysis.js";
import { jitMemoryFaultReason } from "./op-effects.js";

export type JitVirtualFlagMaterialization = Readonly<{
  removedSetCount: number;
  retainedSetCount: number;
  sourceClobberCount: number;
}>;

export function materializeJitVirtualFlags(
  block: JitIrBlock
): Readonly<{ block: JitIrBlock; flags: JitVirtualFlagMaterialization }> {
  const analysis = analyzeJitVirtualFlags(block);
  const instructions = new Array<JitIrBlockInstruction>(block.instructions.length);
  let liveFlags = IR_FLAG_MASK_NONE;
  let removedSetCount = 0;
  let retainedSetCount = 0;

  for (let instructionIndex = block.instructions.length - 1; instructionIndex >= 0; instructionIndex -= 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while materializing virtual flags: ${instructionIndex}`);
    }

    const materializedOps: IrOp[] = [];

    for (let opIndex = instruction.ir.length - 1; opIndex >= 0; opIndex -= 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while materializing virtual flags: ${instructionIndex}:${opIndex}`);
      }

      const reads = flagReads(op, instruction);
      const writes = flagWrites(op);
      const neededWrites = writes & liveFlags;

      if (op.op === "flags.set" && neededWrites === IR_FLAG_MASK_NONE) {
        removedSetCount += 1;
      } else {
        if (op.op === "flags.set") {
          retainedSetCount += 1;
        }

        materializedOps.push(op);
      }

      liveFlags = reads | (liveFlags & ~writes);
    }

    instructions[instructionIndex] = {
      ...instruction,
      ir: materializedOps.reverse()
    };
  }

  return {
    block: { instructions },
    flags: {
      removedSetCount,
      retainedSetCount,
      sourceClobberCount: analysis.sourceClobbers.length
    }
  };
}

function flagReads(op: IrOp, instruction: JitIrBlockInstruction): number {
  const effect = irOpFlagEffect(op);

  return effect.reads | exitFlagReads(op, instruction);
}

function flagWrites(op: IrOp): number {
  const effect = irOpFlagEffect(op);

  return effect.writes | effect.undefines;
}

function exitFlagReads(op: IrOp, instruction: JitIrBlockInstruction): number {
  if (jitMemoryFaultReason(op, instruction.operands) !== undefined) {
    return IR_ALU_FLAG_MASK;
  }

  switch (op.op) {
    case "next":
      return instruction.nextMode === "exit" ? IR_ALU_FLAG_MASK : IR_FLAG_MASK_NONE;
    case "jump":
    case "conditionalJump":
    case "hostTrap":
      return IR_ALU_FLAG_MASK;
    default:
      return IR_FLAG_MASK_NONE;
  }
}
