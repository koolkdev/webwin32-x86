import type { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import type { OperandWidth } from "#x86/isa/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitModuleLinkTable } from "#backends/wasm/jit/compiled-blocks/module-link-table.js";
import { emitIrToWasm, type WasmIrEmitHelpers } from "#backends/wasm/codegen/emit.js";
import type {
  IrSetExprOp,
  IrStorageExpr,
  IrValueExpr
} from "#backends/wasm/codegen/expressions.js";
import { emitFlagProducerCondition } from "#backends/wasm/codegen/conditions.js";
import {
  emitJitConditionalJump,
  emitJitHostTrap,
  emitJitJump,
  emitJitNext,
  emitJitNextEip
} from "./control.js";
import {
  canInlineJitGet,
  emitJitAddress,
  emitJitGet,
  emitJitSet,
  emitJitSetIf
} from "./operands.js";
import type { JitExitPoint, JitInstructionState } from "#backends/wasm/jit/codegen/plan/types.js";
import type { JitExitTarget, JitIrState } from "#backends/wasm/jit/state/state.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/ir/types.js";

export type JitIrInstructionContext = Pick<JitIrBlockInstruction, "ir" | "operands"> & Pick<
  JitInstructionState,
  | "instructionId"
  | "eip"
  | "nextEip"
  | "nextMode"
  | "preInstructionState"
  | "postInstructionState"
  | "preInstructionExitPointCount"
>;

export type JitLinkResolver = Readonly<{
  moduleTable?: JitModuleLinkTable;
  functionIndexForStaticTarget?: (eip: number) => number | undefined;
  slotForStaticTarget?: (eip: number) => number;
}>;

export type JitLinkEmitContext = JitLinkResolver & Readonly<{
  blockTypeIndex: number;
  tableIndex?: number;
}>;

export type JitIrBlockEmitContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitIrState;
  exit: JitExitTarget;
  instructions: readonly JitIrInstructionContext[];
  exitPoints: readonly JitExitPoint[];
  linking?: JitLinkEmitContext;
}>;

export type JitIrContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitIrState;
  exit: JitExitTarget;
  currentInstruction(): JitIrInstructionContext;
  currentExitPoint(exitReason: ExitReasonValue): JitExitPoint;
  completeExitPoint(exitPoint: JitExitPoint): void;
  advanceInstruction(): void;
  linking?: JitLinkEmitContext;
}>;

export function emitJitIrWithContext(context: JitIrBlockEmitContext): void {
  const jitContext = createJitIrContext(context);

  for (let index = 0; index < context.instructions.length; index += 1) {
    beginInstruction(jitContext, context.exit, jitContext.currentInstruction());
    emitCurrentInstruction(jitContext);
  }
}

function createJitIrContext(context: JitIrBlockEmitContext): JitIrContext {
  let instructionIndex = 0;
  let completedPreInstructionExitPointCount = 0;
  const exitPointsByKey = indexExitPoints(context.exitPoints);
  const exitPointUseCounts = new Map<string, number>();

  return {
    body: context.body,
    scratch: context.scratch,
    state: context.state,
    exit: context.exit,
    ...(context.linking === undefined ? {} : { linking: context.linking }),
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
    completeExitPoint: (exitPoint) => {
      if (exitPoint.snapshot.kind !== "preInstruction") {
        return;
      }

      completedPreInstructionExitPointCount += 1;

      const instruction = context.instructions[instructionIndex];

      if (instruction === undefined) {
        throw new Error(`missing JIT IR instruction context: ${instructionIndex}`);
      }

      if (completedPreInstructionExitPointCount > instruction.preInstructionExitPointCount) {
        throw new Error(`completed too many JIT pre-instruction exit points: ${instructionIndex}`);
      }

      if (completedPreInstructionExitPointCount === instruction.preInstructionExitPointCount) {
        context.state.finishPreInstructionExitPoints();
      }
    },
    advanceInstruction: () => {
      instructionIndex += 1;
      completedPreInstructionExitPointCount = 0;
    }
  };
}

function emitCurrentInstruction(jitContext: JitIrContext): void {
  emitJitIrBlock(jitContext, jitContext.currentInstruction().ir);
}

function emitJitIrBlock(jitContext: JitIrContext, ir: JitIrInstructionContext["ir"]): void {
  emitIrToWasm(ir, {
    body: jitContext.body,
    scratch: jitContext.scratch,
    expression: { canInlineGet: (source) => canInlineJitGet(jitContext, source) },
    emitGet: (source, accessWidth, helpers, options) => emitJitGet(jitContext, source, accessWidth, helpers, options),
    emitSet: (target, value, accessWidth, helpers, op) =>
      emitJitSetWithRole(jitContext, target, value, accessWidth, helpers, op),
    emitSetIf: (condition, target, value, accessWidth, helpers) =>
      emitJitSetIf(jitContext, condition, target, value, accessWidth, helpers),
    emitAddress: (source) => emitJitAddress(jitContext, source),
    emitSetFlags: (descriptor, helpers) =>
      jitContext.state.flags.emitSet(descriptor, helpers),
    emitMaterializeFlags: (mask) => jitContext.state.flags.emitMaterialize(mask),
    emitBoundaryFlags: (mask) => jitContext.state.flags.emitBoundary(mask),
    emitAluFlagsCondition: (cc) => jitContext.state.flags.emitAluFlagsCondition(cc),
    emitFlagProducerCondition: (condition, helpers) => emitFlagProducerCondition(jitContext.body, condition, helpers),
    emitNext: () => emitJitNext(jitContext),
    emitNextEip: () => emitJitNextEip(jitContext),
    emitJump: (target, helpers) => emitJitJump(jitContext, target, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitJitConditionalJump(jitContext, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitJitHostTrap(jitContext, vector, helpers)
  });
}

function emitJitSetWithRole(
  jitContext: JitIrContext,
  target: IrStorageExpr,
  value: IrValueExpr,
  accessWidth: OperandWidth,
  helpers: WasmIrEmitHelpers,
  op: IrSetExprOp
): void {
  emitJitSet(jitContext, target, value, accessWidth, helpers);

  if (op.role !== "registerMaterialization") {
    return;
  }

  if (accessWidth !== 32) {
    throw new Error(`JIT register materialization cannot use ${accessWidth}-bit writes`);
  }

  if (target.kind !== "reg") {
    throw new Error(`JIT register materialization cannot target ${target.kind}`);
  }

  jitContext.state.regs.commitPendingReg(target.reg);
}

function beginInstruction(
  context: Pick<JitIrContext, "state">,
  exit: JitExitTarget,
  instruction: JitIrInstructionContext
): void {
  context.state.beginInstruction(exit, instruction.preInstructionState, {
    preserveCommittedRegs: instruction.preInstructionExitPointCount !== 0
  });
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
