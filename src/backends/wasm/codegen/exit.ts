import { encodeExit, type ExitReason } from "#backends/wasm/exit.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";

export type WasmIrExitTarget = Readonly<{
  exitLocal: number;
  exitLabelDepth: number;
  emitBeforeExit?: () => void;
}>;

export function emitWasmIrExitFromI32Stack(
  body: WasmFunctionBodyEncoder,
  target: WasmIrExitTarget,
  exitReason: ExitReason,
  extraDepth = 0,
  detail = 0
): void {
  target.emitBeforeExit?.();
  body.i64ExtendI32U().i64Const(encodeExit(exitReason, 0, detail)).i64Or().localSet(target.exitLocal);
  body.br(target.exitLabelDepth + extraDepth);
}

export function emitWasmIrExitConstPayload(
  body: WasmFunctionBodyEncoder,
  target: WasmIrExitTarget,
  exitReason: ExitReason,
  payload: number,
  extraDepth = 0,
  detail = 0
): void {
  target.emitBeforeExit?.();
  body.i64Const(encodeExit(exitReason, payload, detail)).localSet(target.exitLocal);
  body.br(target.exitLabelDepth + extraDepth);
}
