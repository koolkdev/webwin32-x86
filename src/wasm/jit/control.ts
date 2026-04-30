import type { SirValueExpr } from "../../arch/x86/sir/expressions.js";
import { i32 } from "../../core/state/cpu-state.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitWasmSirExitFromI32Stack } from "../sir/exit.js";
import type { WasmSirEmitHelpers } from "../sir/lower.js";
import type { JitSirContext } from "./sir-context.js";

export function emitJitNext(context: JitSirContext): void {
  if (context.nextMode === "exit") {
    context.state.commitInstructionExit(() => {
      context.body.i32Const(i32(context.nextEip));
    });
    context.body.i32Const(i32(context.nextEip));
    emitWasmSirExitFromI32Stack(context.body, context.exit, ExitReason.FALLTHROUGH);
    return;
  }

  context.state.commitInstruction();
}

export function emitJitNextEip(context: JitSirContext): void {
  context.body.i32Const(i32(context.nextEip));
}

export function emitJitControlExit(
  context: JitSirContext,
  target: SirValueExpr,
  exitReason: ExitReason,
  helpers: WasmSirEmitHelpers,
  extraDepth = 0
): void {
  const targetLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(target);
    context.body.localSet(targetLocal);
    context.state.commitInstructionExit(() => {
      context.body.localGet(targetLocal);
    });
    context.body.localGet(targetLocal);
    emitWasmSirExitFromI32Stack(context.body, context.exit, exitReason, extraDepth);
  } finally {
    context.scratch.freeLocal(targetLocal);
  }
}

export function emitJitConditionalJump(
  context: JitSirContext,
  condition: SirValueExpr,
  taken: SirValueExpr,
  notTaken: SirValueExpr,
  helpers: WasmSirEmitHelpers
): void {
  helpers.emitValue(condition);
  context.body.ifBlock();
  emitJitControlExit(context, taken, ExitReason.BRANCH_TAKEN, helpers, 1);
  context.body.endBlock();
  emitJitControlExit(context, notTaken, ExitReason.BRANCH_NOT_TAKEN, helpers);
}

export function emitJitHostTrap(context: JitSirContext, vector: SirValueExpr, helpers: WasmSirEmitHelpers): void {
  const vectorLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(vector);
    context.body.localSet(vectorLocal);
    context.state.commitInstructionExit(() => {
      context.body.i32Const(i32(context.nextEip));
    });
    context.body.localGet(vectorLocal);
    emitWasmSirExitFromI32Stack(context.body, context.exit, ExitReason.HOST_TRAP);
  } finally {
    context.scratch.freeLocal(vectorLocal);
  }
}
