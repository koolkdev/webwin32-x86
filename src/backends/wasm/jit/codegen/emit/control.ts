import type { IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import { i32 } from "#x86/state/cpu-state.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { emitWasmIrExitFromI32Stack } from "#backends/wasm/codegen/exit.js";
import type { WasmIrEmitHelpers } from "#backends/wasm/codegen/emit.js";
import type { JitExitPoint } from "#backends/wasm/jit/codegen/plan/types.js";
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

export function emitJitJump(context: JitIrContext, target: IrValueExpr, helpers: WasmIrEmitHelpers): void {
  if (emitJitLinkedStaticJump(context, target)) {
    return;
  }

  emitJitControlExit(context, target, ExitReason.JUMP, helpers);
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

function emitJitLinkedStaticJump(context: JitIrContext, target: IrValueExpr): boolean {
  const linking = context.linking;

  if (linking === undefined) {
    return false;
  }

  const targetEip = finalStaticJumpTarget(context, target);

  if (targetEip === undefined) {
    return false;
  }

  const directFunctionIndex = linking.functionIndexForStaticTarget?.(targetEip);

  if (directFunctionIndex !== undefined) {
    const exitPoint = context.currentExitPoint(ExitReason.JUMP);

    emitJitLinkedJumpStateStores(context, targetEip, exitPoint);
    context.body.returnCallFunction(directFunctionIndex);
    return true;
  }

  if (linking.tableIndex !== undefined && linking.slotForStaticTarget !== undefined) {
    const exitPoint = context.currentExitPoint(ExitReason.JUMP);

    emitJitLinkedJumpStateStores(context, targetEip, exitPoint);
    context.body
      .i32Const(linking.slotForStaticTarget(targetEip))
      .returnCallIndirect(linking.blockTypeIndex, linking.tableIndex);
    return true;
  }

  return false;
}

function emitJitLinkedJumpStateStores(context: JitIrContext, targetEip: number, exitPoint: JitExitPoint): void {
  context.state.commitInstructionExit(exitPoint, () => {
    context.body.i32Const(i32(targetEip));
  });
  context.exit.emitBeforeExit?.();
  context.state.emitExitStateStores(exitPoint.exitStateIndex);
}

function finalStaticJumpTarget(context: JitIrContext, target: IrValueExpr): number | undefined {
  const instruction = context.currentInstruction();

  if (
    instruction.nextMode !== "exit" ||
    (instruction.instructionId !== "jmp.rel8" && instruction.instructionId !== "jmp.rel32") ||
    target.kind !== "src32" ||
    target.source.kind !== "operand"
  ) {
    return undefined;
  }

  const binding = instruction.operands[target.source.index];

  return binding?.kind === "static.relTarget" ? binding.target : undefined;
}
