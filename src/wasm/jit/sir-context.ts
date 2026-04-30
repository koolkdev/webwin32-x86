import type { SirProgram } from "../../arch/x86/sir/types.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitCondition } from "../sir/conditions.js";
import { wasmSirLocalEflagsStorage } from "../sir/eflags.js";
import type { WasmSirExitTarget } from "../sir/exit.js";
import { emitSetFlags } from "../sir/flags.js";
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
import type { JitSirState } from "./state.js";

export type JitSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: JitSirState;
  exit: WasmSirExitTarget;
  operands: readonly JitOperandBinding[];
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export function lowerSirWithJitContext(program: SirProgram, context: JitSirContext): void {
  const eflags = wasmSirLocalEflagsStorage(context.body, context.state.eflagsLocal);

  lowerSirToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    expression: { canInlineGet32: (source) => canInlineJitGet32(context, source) },
    emitGet32: (source, helpers) => emitJitGet32(context, source, helpers),
    emitSet32: (target, value, helpers) => emitJitSet32(context, target, value, helpers),
    emitAddress32: (source) => emitJitAddress32(context, source),
    emitSetFlags: (producer, inputs, helpers) =>
      emitSetFlags(context.body, context.scratch, eflags, producer, inputs, helpers),
    emitCondition: (cc) => emitCondition(context.body, eflags, cc),
    emitNext: () => emitJitNext(context),
    emitNextEip: () => emitJitNextEip(context),
    emitJump: (target, helpers) => emitJitControlExit(context, target, ExitReason.JUMP, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitJitConditionalJump(context, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitJitHostTrap(context, vector, helpers)
  });
}
