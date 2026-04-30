import { encodeExit, type ExitReason } from "../exit.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export type WasmSirExitTarget = Readonly<{
  exitLocal: number;
  exitLabelDepth: number;
  emitBeforeExit?: () => void;
}>;

export function emitWasmSirExitFromI32Stack(
  body: WasmFunctionBodyEncoder,
  target: WasmSirExitTarget,
  exitReason: ExitReason,
  extraDepth = 0
): void {
  target.emitBeforeExit?.();
  body.i64ExtendI32U().i64Const(encodeExit(exitReason, 0)).i64Or().localSet(target.exitLocal);
  body.br(target.exitLabelDepth + extraDepth);
}

export function emitWasmSirExitConstPayload(
  body: WasmFunctionBodyEncoder,
  target: WasmSirExitTarget,
  exitReason: ExitReason,
  payload: number,
  extraDepth = 0
): void {
  target.emitBeforeExit?.();
  body.i64Const(encodeExit(exitReason, payload)).localSet(target.exitLocal);
  body.br(target.exitLabelDepth + extraDepth);
}
