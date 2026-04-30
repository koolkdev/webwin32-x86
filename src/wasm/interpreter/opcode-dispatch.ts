import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { dispatchBytes, interpreterOpcodeDispatchRoot } from "./dispatch.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import { emitInstructionHandlerForLeaf } from "./instruction-handlers.js";

export function emitOpcodeDispatch(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  opcodeOffset: number,
  byteLocal: number,
  addressLocal: number,
  opcodeLocal: number,
  scratch: WasmLocalScratchAllocator
): void {
  body.localGet(byteLocal).localSet(opcodeLocal);
  emitOpcodeDispatchNode(
    body,
    interpreterOpcodeDispatchRoot,
    eipLocal,
    opcodeOffset,
    byteLocal,
    addressLocal,
    opcodeLocal,
    scratch
  );
}

function emitOpcodeDispatchNode(
  body: WasmFunctionBodyEncoder,
  node: typeof interpreterOpcodeDispatchRoot,
  eipLocal: number,
  opcodeOffset: number,
  byteLocal: number,
  addressLocal: number,
  unsupportedByteLocal: number,
  scratch: WasmLocalScratchAllocator
): void {
  const bytes = dispatchBytes(node);

  if (bytes.length === 0) {
    body.localGet(unsupportedByteLocal);
    emitExitResultFromStackPayload(body, ExitReason.UNSUPPORTED).returnFromFunction();
    return;
  }

  body.block();

  for (const _byte of bytes) {
    body.block();
  }

  body.localGet(byteLocal).brTable(dispatchTable(bytes), bytes.length);

  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes[index];

    if (byte === undefined) {
      continue;
    }

    const child = node.next[byte];

    if (child === undefined) {
      continue;
    }

    body.endBlock();

    if (child.leaf !== undefined) {
      const emitted = emitInstructionHandlerForLeaf(child.leaf, {
        body,
        scratch,
        eipLocal,
        addressLocal,
        opcodeLocal: unsupportedByteLocal
      });

      if (!emitted) {
        body.localGet(unsupportedByteLocal);
        emitExitResultFromStackPayload(body, ExitReason.UNSUPPORTED).returnFromFunction();
      }
    } else {
      emitLoadGuestByte(body, eipLocal, opcodeOffset + 1, addressLocal, byteLocal);
      emitOpcodeDispatchNode(
        body,
        child,
        eipLocal,
        opcodeOffset + 1,
        byteLocal,
        addressLocal,
        unsupportedByteLocal,
        scratch
      );
      body.localGet(unsupportedByteLocal);
      emitExitResultFromStackPayload(body, ExitReason.UNSUPPORTED).returnFromFunction();
    }
  }

  body.endBlock();
  body.localGet(unsupportedByteLocal);
  emitExitResultFromStackPayload(body, ExitReason.UNSUPPORTED).returnFromFunction();
}

function dispatchTable(bytes: readonly number[]): number[] {
  const table = new Array<number>(256).fill(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];

    if (byte !== undefined) {
      table[byte] = bytes.length - 1 - index;
    }
  }

  return table;
}
