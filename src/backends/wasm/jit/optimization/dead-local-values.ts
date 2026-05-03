import { visitIrOpValueRefs } from "#x86/ir/model/value-uses.js";
import type { IrOp, VarRef } from "#x86/ir/model/types.js";
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

    const dst = opDst(op);

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
  switch (op.op) {
    case "get32":
      return jitMemoryFaultReason(op, instruction.operands) === undefined;
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "aluFlags.condition":
    case "flagProducer.condition":
      return true;
    default:
      return false;
  }
}

function opDst(op: IrOp): VarRef | undefined {
  switch (op.op) {
    case "get32":
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "aluFlags.condition":
    case "flagProducer.condition":
      return op.dst;
    default:
      return undefined;
  }
}
