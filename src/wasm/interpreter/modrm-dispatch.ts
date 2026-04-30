import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";

export function emitRegisterModRmDispatch(
  body: WasmFunctionBodyEncoder,
  modRmLocal: number,
  unsupportedByteLocal: number,
  emitRegisterForm: () => void
): void {
  body.block();
  body.block();
  body.localGet(modRmLocal).brTable(registerModRmTable(), 1);
  body.endBlock();
  emitRegisterForm();
  body.endBlock();
  body.localGet(unsupportedByteLocal);
  emitExitResultFromStackPayload(body, ExitReason.UNSUPPORTED).returnFromFunction();
}

function registerModRmTable(): number[] {
  const table = new Array<number>(256).fill(1);

  for (let byte = 0xc0; byte <= 0xff; byte += 1) {
    table[byte] = 0;
  }

  return table;
}
