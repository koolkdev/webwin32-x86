import type { IrBlock } from "#x86/ir/model/types.js";
import type { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { ExitReason } from "#backends/wasm/exit.js";
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
import type { JitPlannedInstruction } from "#backends/wasm/jit/planning/plan.js";
import type { JitExitTarget, JitIrState } from "#backends/wasm/jit/state/state.js";

export type JitIrInstructionContext = Pick<JitPlannedInstruction, "eip" | "nextEip" | "nextMode">;

export type JitIrBlockLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitIrState;
  exit: JitExitTarget;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitIrInstructionContext[];
}>;

export type JitIrContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitIrState;
  exit: JitExitTarget;
  operands: readonly JitOperandBinding[];
  currentInstruction(): JitIrInstructionContext;
  advanceInstruction(): void;
}>;

export function lowerIrWithJitContext(block: IrBlock, context: JitIrBlockLoweringContext): void {
  const jitContext = createJitIrContext(context);

  context.state.beginInstruction(context.exit, jitContext.currentInstruction().eip);
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
    advanceInstruction: () => {
      instructionIndex += 1;

      const instruction = context.instructions[instructionIndex];

      if (instruction !== undefined) {
        context.state.beginInstruction(context.exit, instruction.eip);
      }
    }
  };
}
