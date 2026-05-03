import {
  jitIrOpDst,
  jitIrOpResult,
  visitJitIrOpValueRefs
} from "#backends/wasm/jit/ir-semantics.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { jitPreInstructionExitReasonAt } from "#backends/wasm/jit/optimization/effects/effects.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";

export type JitDeadLocalValuePruning = Readonly<{
  removedOpCount: number;
}>;

export function pruneDeadJitLocalValues(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitIrBlock; deadLocalValues: JitDeadLocalValuePruning }> {
  const state = new JitOptimizationState(analysis.context);
  let removedOpCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const pruned = pruneInstructionDeadLocalValues(instruction, instructionIndex, state);

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
  state: JitOptimizationState
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

    if (dst !== undefined && !liveVars.has(dst.id) && canDropUnusedResult(op, instructionIndex, opIndex, state)) {
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
  state: JitOptimizationState
): boolean {
  const result = jitIrOpResult(op);

  if (result.kind === "none") {
    return false;
  }

  switch (result.sideEffect) {
    case "none":
      return true;
    case "storageRead":
      return jitPreInstructionExitReasonAt(state.context.effects, instructionIndex, opIndex) === undefined;
  }
}
