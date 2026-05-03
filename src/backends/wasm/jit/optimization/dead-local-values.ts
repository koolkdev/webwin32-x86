import {
  jitIrOpDst,
  jitIrOpResult,
  visitJitIrOpValueRefs
} from "#backends/wasm/jit/ir-semantics.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import { jitPreInstructionExitReasonAt } from "./effects.js";

export type JitDeadLocalValuePruning = Readonly<{
  removedOpCount: number;
}>;

export function pruneDeadJitLocalValues(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitIrBlock; deadLocalValues: JitDeadLocalValuePruning }> {
  let removedOpCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const pruned = pruneInstructionDeadLocalValues(instruction, instructionIndex, analysis);

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
  instructionIndex: number,
  analysis: JitOptimizationAnalysis
): Readonly<{ instruction: JitIrBlockInstruction; removedOpCount: number }> {
  const liveVars = new Set<number>();
  const ops: JitIrOp[] = [];
  let removedOpCount = 0;

  for (let opIndex = instruction.ir.length - 1; opIndex >= 0; opIndex -= 1) {
    const op = instruction.ir[opIndex];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while pruning dead local values: ${instructionIndex}:${opIndex}`);
    }

    const dst = jitIrOpDst(op);

    if (dst !== undefined && !liveVars.has(dst.id) && canDropUnusedResult(op, instructionIndex, opIndex, analysis)) {
      removedOpCount += 1;
      continue;
    }

    if (dst !== undefined) {
      liveVars.delete(dst.id);
    }

    visitJitIrOpValueRefs(op, (value) => {
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

function canDropUnusedResult(
  op: JitIrOp,
  instructionIndex: number,
  opIndex: number,
  analysis: JitOptimizationAnalysis
): boolean {
  const result = jitIrOpResult(op);

  if (result.kind === "none") {
    return false;
  }

  switch (result.sideEffect) {
    case "none":
      return true;
    case "storageRead":
      return jitPreInstructionExitReasonAt(analysis.context.effects, instructionIndex, opIndex) === undefined;
  }
}
