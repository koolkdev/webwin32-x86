import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization, type JitOptimizationAnalysis } from "./analysis.js";
import type { JitFlagSource } from "./flag-sources.js";
import {
  analyzeJitFlags,
  type JitFlagAnalysis
} from "./flag-analysis.js";
import {
  emitDirectFlagCondition,
  indexDirectFlagConditions,
  type JitDirectFlagConditionIndex
} from "./flag-condition-planning.js";
import { rewriteJitIrInstruction } from "./rewrite.js";

export type JitFlagMaterialization = Readonly<{
  removedSetCount: number;
  retainedSetCount: number;
  directConditionCount: number;
  sourceClobberCount: number;
}>;

export function materializeJitFlags(
  block: JitIrBlock,
  optimizationAnalysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitIrBlock; flags: JitFlagMaterialization }> {
  const flagAnalysis = analyzeJitFlags(block, optimizationAnalysis);
  const directConditionsByLocation = indexDirectFlagConditions(block, flagAnalysis);
  const neededSourceIds = neededFlagSourceIds(flagAnalysis, directConditionsByLocation);
  const sourcesByLocation = indexFlagSourcesByLocation(flagAnalysis);
  const instructions = new Array<JitIrBlockInstruction>(block.instructions.length);
  let removedSetCount = 0;
  let retainedSetCount = 0;
  let directConditionCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while materializing flags: ${instructionIndex}`);
    }

    instructions[instructionIndex] = rewriteJitIrInstruction(
      instruction,
      instructionIndex,
      "materializing flags",
      ({ op, opIndex, rewrite }) => {
        const source = sourcesByLocation.get(instructionIndex)?.get(opIndex);
        const directCondition = directConditionsByLocation.get(instructionIndex)?.get(opIndex);

        if (op.op === "flags.set" && (source === undefined || !neededSourceIds.has(source.id))) {
          removedSetCount += 1;
        } else if (op.op === "aluFlags.condition" && directCondition !== undefined) {
          emitDirectFlagCondition(rewrite, op, directCondition);
          directConditionCount += 1;
        } else {
          if (op.op === "flags.set") {
            retainedSetCount += 1;
          }

          rewrite.ops.push(op);
        }
      }
    );
  }

  return {
    block: { instructions },
    flags: {
      removedSetCount,
      retainedSetCount,
      directConditionCount,
      sourceClobberCount: flagAnalysis.sourceClobbers.length
    }
  };
}

function neededFlagSourceIds(
  analysis: JitFlagAnalysis,
  directConditionsByLocation: JitDirectFlagConditionIndex
): ReadonlySet<number> {
  const neededSourceIds = new Set<number>();

  for (const read of analysis.reads) {
    if (directConditionsByLocation.get(read.instructionIndex)?.has(read.opIndex) === true) {
      continue;
    }

    for (const { owner } of read.owners) {
      if (owner.kind === "producer") {
        neededSourceIds.add(owner.source.id);
      }
    }
  }

  return neededSourceIds;
}

function indexFlagSourcesByLocation(
  analysis: JitFlagAnalysis
): ReadonlyMap<number, ReadonlyMap<number, JitFlagSource>> {
  const sourcesByLocation = new Map<number, Map<number, JitFlagSource>>();

  for (const source of analysis.sources) {
    let instructionSources = sourcesByLocation.get(source.instructionIndex);

    if (instructionSources === undefined) {
      instructionSources = new Map();
      sourcesByLocation.set(source.instructionIndex, instructionSources);
    }

    instructionSources.set(source.opIndex, source);
  }

  return sourcesByLocation;
}
