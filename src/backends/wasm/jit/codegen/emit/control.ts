import type { IrValueExpr } from "#backends/wasm/lowering/expressions.js";
import { i32 } from "#x86/state/cpu-state.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { emitWasmIrExitFromI32Stack } from "#backends/wasm/lowering/exit.js";
import type { WasmIrEmitHelpers } from "#backends/wasm/lowering/lower.js";
import type { JitIrContext } from "./ir-context.js";

export function emitJitNext(context: JitIrContext): void {
  const instruction = context.currentInstruction();

  if (instruction.nextMode === "exit") {
    const exitPoint = context.currentExitPoint(ExitReason.FALLTHROUGH);

    context.state.commitInstructionExit(
      exitPoint,
      () => {
        context.body.i32Const(i32(instruction.nextEip));
      }
    );
    context.body.i32Const(i32(instruction.nextEip));
    emitWasmIrExitFromI32Stack(context.body, context.exit, ExitReason.FALLTHROUGH);
    return;
  }

  context.state.commitInstruction();
  context.advanceInstruction();
}

export function emitJitNextEip(context: JitIrContext): void {
  context.body.i32Const(i32(context.currentInstruction().nextEip));
}

export function emitJitControlExit(
  context: JitIrContext,
  target: IrValueExpr,
  exitReason: ExitReason,
  helpers: WasmIrEmitHelpers,
  extraDepth = 0
): void {
  const targetLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(target);
    context.body.localSet(targetLocal);
    const exitPoint = context.currentExitPoint(exitReason);

    context.state.commitInstructionExit(
      exitPoint,
      () => {
        context.body.localGet(targetLocal);
      }
    );
    context.body.localGet(targetLocal);
    emitWasmIrExitFromI32Stack(context.body, context.exit, exitReason, extraDepth);
  } finally {
    context.scratch.freeLocal(targetLocal);
  }
}

export function emitJitConditionalJump(
  context: JitIrContext,
  condition: IrValueExpr,
  taken: IrValueExpr,
  notTaken: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  helpers.emitValue(condition);
  context.body.ifBlock();
  emitJitControlExit(context, taken, ExitReason.BRANCH_TAKEN, helpers, 1);
  context.body.endBlock();
  emitJitControlExit(context, notTaken, ExitReason.BRANCH_NOT_TAKEN, helpers);
}

export function emitJitHostTrap(context: JitIrContext, vector: IrValueExpr, helpers: WasmIrEmitHelpers): void {
  const vectorLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(vector);
    context.body.localSet(vectorLocal);
    const instruction = context.currentInstruction();
    const exitPoint = context.currentExitPoint(ExitReason.HOST_TRAP);

    context.state.commitInstructionExit(
      exitPoint,
      () => {
        context.body.i32Const(i32(instruction.nextEip));
      }
    );
    context.body.localGet(vectorLocal);
    emitWasmIrExitFromI32Stack(context.body, context.exit, ExitReason.HOST_TRAP);
  } finally {
    context.scratch.freeLocal(vectorLocal);
  }
}
