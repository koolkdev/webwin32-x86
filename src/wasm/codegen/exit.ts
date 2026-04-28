import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { encodeExit, type ExitReason } from "../exit.js";

export function emitExitResult(
  body: WasmFunctionBodyEncoder,
  exitReason: ExitReason,
  payload: number
): WasmFunctionBodyEncoder {
  return body.i64Const(encodeExit(exitReason, payload));
}
