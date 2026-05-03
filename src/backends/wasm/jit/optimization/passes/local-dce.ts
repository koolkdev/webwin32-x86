import {
  jitIrOpDst,
  jitIrOpResult,
  visitJitIrOpValueRefs
} from "#backends/wasm/jit/ir-semantics.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  indexJitEffects,
  jitPreInstructionExitReasonAt,
  type JitEffectIndex
} from "#backends/wasm/jit/ir/effects.js";
import type { JitOptimizationPass } from "#backends/wasm/jit/optimization/pass.js";

export type JitLocalDce = Readonly<{
  removedOpCount: number;
}>;

export type JitDeadLocalValuePruning = JitLocalDce;

export const localDcePass = {
  name: "local-dce",
  run(block) {
    const result = pruneDeadJitLocalValues(block);

    return {
      block: result.block,
      changed: result.localDce.removedOpCount !== 0,
      stats: result.localDce
    };
  }
} satisfies JitOptimizationPass<"local-dce">;

export function pruneDeadJitLocalValues(
  block: JitIrBlock,
  effects: JitEffectIndex = indexJitEffects(block)
): Readonly<{ block: JitIrBlock; localDce: JitLocalDce; deadLocalValues: JitDeadLocalValuePruning }> {
  let removedOpCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const pruned = pruneInstructionDeadLocalValues(instruction, instructionIndex, effects);

    removedOpCount += pruned.removedOpCount;
    return pruned.instruction;
  });

  return {
    block: { instructions },
    localDce: { removedOpCount },
    deadLocalValues: { removedOpCount }
  };
}

function pruneInstructionDeadLocalValues(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  effects: JitEffectIndex
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

    if (dst !== undefined && !liveVars.has(dst.id) && canDropUnusedResult(op, instructionIndex, opIndex, effects)) {
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
  effects: JitEffectIndex
): boolean {
  const result = jitIrOpResult(op);

  if (result.kind === "none") {
    return false;
  }

  switch (result.sideEffect) {
    case "none":
      return true;
    case "storageRead":
      return jitPreInstructionExitReasonAt(effects, instructionIndex, opIndex) === undefined;
  }
}
