import { toJitOptimizedIrPreludeOp } from "#backends/wasm/jit/prelude.js";
import type {
  JitIrBlock,
  JitIrBlockInstruction,
  JitIrOp,
  JitOptimizedIrBlock,
  JitOptimizedIrBlockInstruction
} from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import {
  analyzeJitFlags,
  type JitFlagAnalysis
} from "#backends/wasm/jit/optimization/flags/analysis.js";
import {
  emitDirectFlagCondition,
  indexDirectFlagConditions,
  type JitDirectFlagConditionIndex
} from "#backends/wasm/jit/optimization/flags/conditions.js";
import type { JitFlagMaterialization } from "#backends/wasm/jit/optimization/flags/materialization.js";
import type { JitFlagSource } from "#backends/wasm/jit/optimization/flags/sources.js";
import {
  firstRegisterFoldableOpIndex,
  recordCopiedRegisterOp
} from "#backends/wasm/jit/optimization/registers/folding-prefix.js";
import {
  materializeRegisterValuesForPostInstructionExit,
  materializeRegisterValuesForPreInstructionExits
} from "#backends/wasm/jit/optimization/registers/materialization.js";
import {
  rewriteRegisterAddress32,
  rewriteRegisterGet32,
  rewriteRegisterSet32,
  rewriteRegisterSet32If,
  unchangedJitRegisterRewriteResult,
  type JitRegisterRewriteResult
} from "#backends/wasm/jit/optimization/registers/rewrite.js";
import {
  createJitPreludeRewrite,
  rewriteJitIrInstruction,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "#backends/wasm/jit/optimization/ir/rewrite.js";
import type { JitRegisterFolding } from "#backends/wasm/jit/optimization/passes/register-folding.js";

export function emitJitFlagMaterialization(
  block: JitIrBlock,
  optimizationAnalysis: JitOptimizationAnalysis
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

export function emitJitRegisterFolding(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis
): Readonly<{ block: JitOptimizedIrBlock; folding: JitRegisterFolding }> {
  const state = new JitOptimizationState(analysis.context);
  const instructions: JitOptimizedIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let materializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while folding register values: ${instructionIndex}`);
    }

    const prelude = createJitPreludeRewrite();

    materializedSetCount += materializeRegisterValuesForPreInstructionExits(
      prelude,
      instructionIndex,
      state
    );

    const rewrite = state.beginInstructionRewrite(instruction);
    const firstFoldableOpIndex = firstRegisterFoldableOpIndex(instructionIndex, state);

    rewriteJitIrInstructionInto(
      instruction,
      instructionIndex,
      "folding register values",
      rewrite,
      ({ op, opIndex }) => {
        if (opIndex < firstFoldableOpIndex) {
          recordCopiedRegisterOp(op, instruction, rewrite);
          rewrite.ops.push(op);
          return;
        }

        const result = rewriteRegisterOp(
          op,
          instruction,
          instructionIndex,
          opIndex,
          rewrite,
          state
        );

        if (result.removedSet) {
          removedSetCount += 1;
        }

        materializedSetCount += result.materializedSetCount;
      }
    );

    instructions.push({
      ...instruction,
      prelude: prelude.ops.map(toJitOptimizedIrPreludeOp),
      ir: rewrite.ops
    });
  }

  if (state.tracked.registers.size !== 0) {
    throw new Error("JIT register values were not materialized before block end");
  }

  return {
    block: { instructions },
    folding: { removedSetCount, materializedSetCount }
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

function rewriteRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteRegisterGet32(op, instruction, rewrite, state);
    case "const32":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
    case "address32":
      return rewriteRegisterAddress32(op, instruction, rewrite, state);
    case "set32":
      return rewriteRegisterSet32(op, instruction, rewrite, state);
    case "set32.if":
      return rewriteRegisterSet32If(op, instruction, rewrite, state);
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const materializedSetCount = materializeRegisterValuesForPostInstructionExit(
        rewrite,
        instructionIndex,
        opIndex,
        state
      );

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
  }
}
