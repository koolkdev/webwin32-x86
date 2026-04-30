import { WasmFunctionBodyEncoder } from "./encoder/function-body.js";
import { encodeExit, type ExitReason } from "./exit.js";

export function emitExitResult(
  body: WasmFunctionBodyEncoder,
  exitReason: ExitReason,
  payload: number
): WasmFunctionBodyEncoder {
  return body.i64Const(encodeExit(exitReason, payload));
}

export function emitExitResultFromStackPayload(
  body: WasmFunctionBodyEncoder,
  exitReason: ExitReason
): WasmFunctionBodyEncoder {
  return body.i64ExtendI32U().i64Const(encodeExit(exitReason, 0)).i64Or();
}
