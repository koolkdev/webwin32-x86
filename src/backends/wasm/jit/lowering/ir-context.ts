import type { IrBlock } from "#x86/ir/model/types.js";
import type { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { lowerIrToWasm } from "#backends/wasm/lowering/lower.js";
import { emitFlagProducerCondition } from "#backends/wasm/lowering/conditions.js";
import {
  emitJitConditionalJump,
  emitJitControlExit,
  emitJitHostTrap,
  emitJitNext,
  emitJitNextEip
} from "./control.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import {
  canInlineJitGet32,
  emitJitAddress32,
  emitJitGet32,
  emitJitSet32
} from "./operands.js";
import type { JitExitPoint, JitInstructionState } from "#backends/wasm/jit/optimization/optimize.js";
import type { JitExitTarget, JitIrState } from "#backends/wasm/jit/state/state.js";

export type JitIrInstructionContext = Pick<
  JitInstructionState,
  | "instructionId"
  | "eip"
  | "nextEip"
  | "nextMode"
  | "preInstructionState"
  | "postInstructionState"
>;

export type JitIrBlockLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitIrState;
  exit: JitExitTarget;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitIrInstructionContext[];
  exitPoints: readonly JitExitPoint[];
}>;

export type JitIrContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitIrState;
  exit: JitExitTarget;
  operands: readonly JitOperandBinding[];
  currentInstruction(): JitIrInstructionContext;
  currentExitPoint(exitReason: ExitReasonValue): JitExitPoint;
  advanceInstruction(): void;
}>;

export function lowerIrWithJitContext(block: IrBlock, context: JitIrBlockLoweringContext): void {
  const jitContext = createJitIrContext(context);

  beginInstruction(jitContext, context.exit, jitContext.currentInstruction());
  lowerIrToWasm(block, {
    body: jitContext.body,
    scratch: jitContext.scratch,
    expression: { canInlineGet32: (source) => canInlineJitGet32(jitContext, source) },
    emitGet32: (source, helpers) => emitJitGet32(jitContext, source, helpers),
    emitSet32: (target, value, helpers) => emitJitSet32(jitContext, target, value, helpers),
    emitAddress32: (source) => emitJitAddress32(jitContext, source),
    emitSetFlags: (descriptor, helpers) =>
      jitContext.state.flags.emitSet(descriptor, helpers),
    emitMaterializeFlags: (mask) => jitContext.state.flags.emitMaterialize(mask),
    emitBoundaryFlags: (mask) => jitContext.state.flags.emitBoundary(mask),
    emitAluFlagsCondition: (cc) => jitContext.state.flags.emitAluFlagsCondition(cc),
    emitFlagProducerCondition: (condition, helpers) => emitFlagProducerCondition(jitContext.body, condition, helpers),
    emitNext: () => emitJitNext(jitContext),
    emitNextEip: () => emitJitNextEip(jitContext),
    emitJump: (target, helpers) => emitJitControlExit(jitContext, target, ExitReason.JUMP, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitJitConditionalJump(jitContext, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitJitHostTrap(jitContext, vector, helpers)
  });
}

function createJitIrContext(context: JitIrBlockLoweringContext): JitIrContext {
  let instructionIndex = 0;
  const exitPointsByKey = indexExitPoints(context.exitPoints);
  const exitPointUseCounts = new Map<string, number>();

  return {
    body: context.body,
    scratch: context.scratch,
    state: context.state,
    exit: context.exit,
    operands: context.operands,
    currentInstruction: () => {
      const instruction = context.instructions[instructionIndex];

      if (instruction === undefined) {
        throw new Error(`missing JIT IR instruction context: ${instructionIndex}`);
      }

      return instruction;
    },
    currentExitPoint: (exitReason) => {
      const key = exitPointKey(instructionIndex, exitReason);
      const exitPoints = exitPointsByKey.get(key) ?? [];
      const useCount = exitPointUseCounts.get(key) ?? 0;
      const exitPoint = exitPoints[useCount];

      if (exitPoint === undefined) {
        throw new Error(`missing JIT exit point for instruction ${instructionIndex} reason ${exitReason}`);
      }

      exitPointUseCounts.set(key, useCount + 1);
      return exitPoint;
    },
    advanceInstruction: () => {
      instructionIndex += 1;

      const instruction = context.instructions[instructionIndex];

      if (instruction !== undefined) {
        beginInstruction(context, context.exit, instruction);
      }
    }
  };
}

function beginInstruction(
  context: Pick<JitIrContext, "state">,
  exit: JitExitTarget,
  instruction: JitIrInstructionContext
): void {
  context.state.beginInstruction(exit, instruction.preInstructionState);
}

function indexExitPoints(exitPoints: readonly JitExitPoint[]): ReadonlyMap<string, readonly JitExitPoint[]> {
  const exitPointsByKey = new Map<string, JitExitPoint[]>();

  for (const exitPoint of exitPoints) {
    const key = exitPointKey(exitPoint.instructionIndex, exitPoint.exitReason);
    const instructionExitPoints = exitPointsByKey.get(key);

    if (instructionExitPoints === undefined) {
      exitPointsByKey.set(key, [exitPoint]);
    } else {
      instructionExitPoints.push(exitPoint);
    }
  }

  return exitPointsByKey;
}

function exitPointKey(instructionIndex: number, exitReason: ExitReasonValue): string {
  return `${instructionIndex}:${exitReason}`;
}
