import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  analyzeJitVirtualFlags,
  type JitVirtualFlagAnalysis,
  type JitVirtualFlagSource
} from "./virtual-flag-analysis.js";

export type JitVirtualFlagMaterialization = Readonly<{
  removedSetCount: number;
  retainedSetCount: number;
  sourceClobberCount: number;
}>;

export function materializeJitVirtualFlags(
  block: JitIrBlock
): Readonly<{ block: JitIrBlock; flags: JitVirtualFlagMaterialization }> {
  const analysis = analyzeJitVirtualFlags(block);
  const neededSourceIds = neededVirtualFlagSourceIds(analysis);
  const sourcesByLocation = indexVirtualFlagSourcesByLocation(analysis);
  const instructions = new Array<JitIrBlockInstruction>(block.instructions.length);
  let removedSetCount = 0;
  let retainedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while materializing virtual flags: ${instructionIndex}`);
    }

    const materializedOps: IrOp[] = [];

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while materializing virtual flags: ${instructionIndex}:${opIndex}`);
      }

      const source = sourcesByLocation.get(instructionIndex)?.get(opIndex);

      if (op.op === "flags.set" && (source === undefined || !neededSourceIds.has(source.id))) {
        removedSetCount += 1;
      } else {
        if (op.op === "flags.set") {
          retainedSetCount += 1;
        }

        materializedOps.push(op);
      }
    }

    instructions[instructionIndex] = {
      ...instruction,
      ir: materializedOps
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

function neededVirtualFlagSourceIds(analysis: JitVirtualFlagAnalysis): ReadonlySet<number> {
  const neededSourceIds = new Set<number>();

  for (const read of analysis.reads) {
    for (const { owner } of read.owners) {
      if (owner.kind === "producer") {
        neededSourceIds.add(owner.source.id);
      }
    }
  }

  return neededSourceIds;
}

function indexVirtualFlagSourcesByLocation(
  analysis: JitVirtualFlagAnalysis
): ReadonlyMap<number, ReadonlyMap<number, JitVirtualFlagSource>> {
  const sourcesByLocation = new Map<number, Map<number, JitVirtualFlagSource>>();

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
