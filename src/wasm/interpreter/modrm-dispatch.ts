import type { Reg3 } from "../../arch/x86/isa/schema/types.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitWasmSirExit, type WasmSirExitTarget } from "../sir/exit.js";
import { emitModRmRegIndex } from "./modrm-bits.js";

export type ModRmDispatchCase = Readonly<{
  regs: readonly Reg3[];
  emit: () => void;
}>;

export function emitModRmDispatch(
  body: WasmFunctionBodyEncoder,
  exit: WasmSirExitTarget,
  modRmLocal: number,
  unsupportedByteLocal: number,
  cases: readonly ModRmDispatchCase[]
): void {
  body.block();

  for (const _case of cases) {
    body.block();
  }

  emitModRmRegIndex(body, modRmLocal);
  body.brTable(registerModRmTable(cases), cases.length);

  for (let index = cases.length - 1; index >= 0; index -= 1) {
    const dispatchCase = cases[index];

    if (dispatchCase === undefined) {
      continue;
    }

    body.endBlock();
    dispatchCase.emit();
  }

  body.endBlock();
  emitWasmSirExit(body, exit, ExitReason.UNSUPPORTED, () => {
    body.localGet(unsupportedByteLocal);
  });
}

function registerModRmTable(cases: readonly ModRmDispatchCase[]): number[] {
  const table = new Array<number>(8).fill(cases.length);

  for (let index = 0; index < cases.length; index += 1) {
    const dispatchCase = cases[index];

    if (dispatchCase === undefined) {
      continue;
    }

    const depth = cases.length - 1 - index;

    for (const reg of dispatchCase.regs) {
      table[reg] = depth;
    }
  }

  return table;
}
