import type { IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import { i32, u32 } from "#x86/state/cpu-state.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { emitWasmIrExitFromI32Stack } from "#backends/wasm/codegen/exit.js";
import type { WasmIrEmitHelpers } from "#backends/wasm/codegen/emit.js";
import type { JitExitPoint } from "#backends/wasm/jit/codegen/plan/types.js";
import type { JitIrContext } from "./ir-context.js";

export function emitJitNext(context: JitIrContext): void {
  const instruction = context.currentInstruction();

  if (instruction.nextMode === "exit") {
    emitJitStaticControlTransfer(context, instruction.nextEip, ExitReason.FALLTHROUGH);
    return;
  }

  context.state.commitInstruction();
  context.advanceInstruction();
}

export function emitJitNextEip(context: JitIrContext): void {
  context.body.i32Const(i32(context.currentInstruction().nextEip));
}

export function emitJitJump(context: JitIrContext, target: IrValueExpr, helpers: WasmIrEmitHelpers): void {
  if (emitJitControlTransfer(context, target, ExitReason.JUMP, helpers)) {
    return;
  }
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
  emitJitControlTransfer(context, taken, ExitReason.BRANCH_TAKEN, helpers, 1);
  context.body.endBlock();
  emitJitControlTransfer(context, notTaken, ExitReason.BRANCH_NOT_TAKEN, helpers);
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

function emitJitControlTransfer(
  context: JitIrContext,
  target: IrValueExpr,
  exitReason: ExitReasonValue,
  helpers: WasmIrEmitHelpers,
  extraDepth = 0
): boolean {
  const targetEip = staticControlTarget(context, target);

  if (targetEip === undefined) {
    emitJitControlExit(context, target, exitReason, helpers, extraDepth);
    return false;
  }

  emitJitStaticControlTransfer(context, targetEip, exitReason, extraDepth);
  return true;
}

function emitJitStaticControlTransfer(
  context: JitIrContext,
  targetEip: number,
  exitReason: ExitReasonValue,
  extraDepth = 0
): void {
  const exitPoint = context.currentExitPoint(exitReason);

  context.state.commitInstructionExit(exitPoint, () => {
    context.body.i32Const(i32(targetEip));
  });

  if (emitJitLinkedStaticControlTransfer(context, targetEip, exitPoint)) {
    return;
  }

  context.body.i32Const(i32(targetEip));
  emitWasmIrExitFromI32Stack(context.body, context.exit, exitReason, extraDepth);
}

function emitJitLinkedStaticControlTransfer(
  context: JitIrContext,
  targetEip: number,
  exitPoint: JitExitPoint
): boolean {
  const linking = context.linking;

  if (linking === undefined) {
    return false;
  }

  const directFunctionIndex = linking.functionIndexForStaticTarget?.(targetEip);

  if (directFunctionIndex !== undefined) {
    emitJitLinkedControlTransferStateStores(context, exitPoint);
    context.body.returnCallFunction(directFunctionIndex);
    return true;
  }

  if (linking.tableIndex !== undefined && linking.slotForStaticTarget !== undefined) {
    emitJitLinkedControlTransferStateStores(context, exitPoint);
    context.body
      .i32Const(linking.slotForStaticTarget(targetEip))
      .returnCallIndirect(linking.blockTypeIndex, linking.tableIndex);
    return true;
  }

  return false;
}

function emitJitLinkedControlTransferStateStores(
  context: JitIrContext,
  exitPoint: JitExitPoint
): void {
  context.exit.emitBeforeExit?.();
  context.state.emitExitStateStores(exitPoint.exitStateIndex);
}

function staticControlTarget(context: JitIrContext, target: IrValueExpr): number | undefined {
  const instruction = context.currentInstruction();

  if (instruction.nextMode !== "exit") {
    return undefined;
  }

  switch (target.kind) {
    case "const32":
      return u32(target.value);
    case "nextEip":
      return u32(instruction.nextEip);
    case "source": {
      if (target.source.kind !== "operand") {
        return undefined;
      }

      const binding = instruction.operands[target.source.index];

      return binding?.kind === "static.relTarget" ? binding.target : undefined;
    }
    default:
      return undefined;
  }
}
