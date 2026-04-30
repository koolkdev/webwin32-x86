import { encodeExit, type ExitReason } from "../exit.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export type InterpreterExitTarget = Readonly<{
  exitLocal: number;
  exitLabelDepth: number;
}>;

export function emitInterpreterExit(
  body: WasmFunctionBodyEncoder,
  target: InterpreterExitTarget,
  exitReason: ExitReason,
  emitPayload: () => void,
  extraDepth = 0
): void {
  emitPayload();
  body.i64ExtendI32U().i64Const(encodeExit(exitReason, 0)).i64Or().localSet(target.exitLocal);
  body.br(target.exitLabelDepth + extraDepth);
}

export function emitInterpreterExitConstPayload(
  body: WasmFunctionBodyEncoder,
  target: InterpreterExitTarget,
  exitReason: ExitReason,
  payload: number,
  extraDepth = 0
): void {
  body.i64Const(encodeExit(exitReason, payload)).localSet(target.exitLocal);
  body.br(target.exitLabelDepth + extraDepth);
}
