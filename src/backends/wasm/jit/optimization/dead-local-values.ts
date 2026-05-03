import {
  irOpDst,
  irOpResult,
  visitIrOpValueRefs
} from "#x86/ir/model/op-semantics.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { jitMemoryFaultReason } from "./op-effects.js";

export type JitDeadLocalValuePruning = Readonly<{
  removedOpCount: number;
}>;

export function pruneDeadJitLocalValues(
  block: JitIrBlock
): Readonly<{ block: JitIrBlock; deadLocalValues: JitDeadLocalValuePruning }> {
  let removedOpCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const pruned = pruneInstructionDeadLocalValues(instruction, instructionIndex);

    removedOpCount += pruned.removedOpCount;
    return pruned.instruction;
  });

  return {
    block: { instructions },
    deadLocalValues: { removedOpCount }
  };
}

function pruneInstructionDeadLocalValues(
  instruction: JitIrBlockInstruction,
  instructionIndex: number
): Readonly<{ instruction: JitIrBlockInstruction; removedOpCount: number }> {
  const liveVars = new Set<number>();
  const ops: IrOp[] = [];
  let removedOpCount = 0;

  for (let opIndex = instruction.ir.length - 1; opIndex >= 0; opIndex -= 1) {
    const op = instruction.ir[opIndex];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while pruning dead local values: ${instructionIndex}:${opIndex}`);
    }

    const dst = irOpDst(op);

    if (dst !== undefined && !liveVars.has(dst.id) && isPureLocalDefinition(op, instruction)) {
      removedOpCount += 1;
      continue;
    }

    if (dst !== undefined) {
      liveVars.delete(dst.id);
    }

    visitIrOpValueRefs(op, (value) => {
      if (value.kind === "var") {
        liveVars.add(value.id);
      }
    });
    ops.push(op);
  }

  ops.reverse();
  return {
    instruction: {
      ...instruction,
      ir: ops
    },
    removedOpCount
  };
}

function isPureLocalDefinition(op: IrOp, instruction: JitIrBlockInstruction): boolean {
  const result = irOpResult(op);

  if (result.kind === "none") {
    return false;
  }

  switch (result.sideEffect) {
    case "none":
      return true;
    case "storageRead":
      return jitMemoryFaultReason(op, instruction.operands) === undefined;
  }
}
