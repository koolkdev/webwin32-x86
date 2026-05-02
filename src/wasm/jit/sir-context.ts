import type { SirProgram } from "../../arch/x86/sir/types.js";
import type { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { lowerSirToWasm } from "../sir/lower.js";
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
import type { JitExitTarget, JitSirState } from "./state.js";

export type JitSirInstructionContext = Readonly<{
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitSirBlockLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitSirState;
  exit: JitExitTarget;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitSirInstructionContext[];
}>;

export type JitSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitSirState;
  exit: JitExitTarget;
  operands: readonly JitOperandBinding[];
  currentInstruction(): JitSirInstructionContext;
  advanceInstruction(): void;
}>;

export function lowerSirWithJitContext(program: SirProgram, context: JitSirBlockLoweringContext): void {
  const jitContext = createJitSirContext(context);

  context.state.beginInstruction(context.exit, jitContext.currentInstruction().eip);
  lowerSirToWasm(program, {
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
    emitCondition: (cc) => jitContext.state.flags.emitCondition(cc),
    emitNext: () => emitJitNext(jitContext),
    emitNextEip: () => emitJitNextEip(jitContext),
    emitJump: (target, helpers) => emitJitControlExit(jitContext, target, ExitReason.JUMP, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitJitConditionalJump(jitContext, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitJitHostTrap(jitContext, vector, helpers)
  });
}

function createJitSirContext(context: JitSirBlockLoweringContext): JitSirContext {
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
        throw new Error(`missing JIT SIR instruction context: ${instructionIndex}`);
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
