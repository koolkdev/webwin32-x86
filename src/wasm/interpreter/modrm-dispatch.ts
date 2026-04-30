import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";

export type RegisterModRmDispatchCase = Readonly<{
  bytes: readonly number[];
  emit: () => void;
}>;

export function emitRegisterModRmDispatch(
  body: WasmFunctionBodyEncoder,
  modRmLocal: number,
  unsupportedByteLocal: number,
  cases: readonly RegisterModRmDispatchCase[]
): void {
  body.block();

  for (const _case of cases) {
    body.block();
  }

  body.localGet(modRmLocal).brTable(registerModRmTable(cases), cases.length);

  for (let index = cases.length - 1; index >= 0; index -= 1) {
    const dispatchCase = cases[index];

    if (dispatchCase === undefined) {
      continue;
    }

    body.endBlock();
    dispatchCase.emit();
  }

  body.endBlock();
  body.localGet(unsupportedByteLocal);
  emitExitResultFromStackPayload(body, ExitReason.UNSUPPORTED).returnFromFunction();
}

function registerModRmTable(cases: readonly RegisterModRmDispatchCase[]): number[] {
  const table = new Array<number>(256).fill(cases.length);

  for (let index = 0; index < cases.length; index += 1) {
    const dispatchCase = cases[index];

    if (dispatchCase === undefined) {
      continue;
    }

    const depth = cases.length - 1 - index;

    for (const byte of dispatchCase.bytes) {
      table[byte] = depth;
    }
  }

  return table;
}
