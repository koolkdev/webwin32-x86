import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { dispatchBytes, interpreterOpcodeDispatchRoot } from "./dispatch.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import { emitInstructionHandlerForLeaf } from "./instruction-handlers.js";

type OpcodeDispatchContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  eipLocal: number;
  opcodeOffset: number;
  byteLocal: number;
  addressLocal: number;
  opcodeLocal: number;
  scratch: WasmLocalScratchAllocator;
  instructionDoneLabelDepth: number;
}>;

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
  emitOpcodeDispatchNode(interpreterOpcodeDispatchRoot, {
    body,
    eipLocal,
    opcodeOffset,
    byteLocal,
    addressLocal,
    opcodeLocal,
    scratch,
    instructionDoneLabelDepth: 0
  });
}

function emitOpcodeDispatchNode(node: typeof interpreterOpcodeDispatchRoot, context: OpcodeDispatchContext): void {
  const bytes = dispatchBytes(node);

  if (bytes.length === 0) {
    context.body.localGet(context.opcodeLocal);
    emitExitResultFromStackPayload(context.body, ExitReason.UNSUPPORTED).returnFromFunction();
    return;
  }

  context.body.block();

  for (const _byte of bytes) {
    context.body.block();
  }

  context.body.localGet(context.byteLocal).brTable(dispatchTable(bytes), bytes.length);

  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes[index];

    if (byte === undefined) {
      continue;
    }

    const child = node.next[byte];

    if (child === undefined) {
      continue;
    }

    context.body.endBlock();

    if (child.leaf !== undefined) {
      const emitted = emitInstructionHandlerForLeaf(child.leaf, {
        body: context.body,
        scratch: context.scratch,
        eipLocal: context.eipLocal,
        addressLocal: context.addressLocal,
        opcodeLocal: context.opcodeLocal,
        instructionDoneLabelDepth: context.instructionDoneLabelDepth + 1 + index
      });

      if (!emitted) {
        context.body.localGet(context.opcodeLocal);
        emitExitResultFromStackPayload(context.body, ExitReason.UNSUPPORTED).returnFromFunction();
      }
    } else {
      emitLoadGuestByte(
        context.body,
        context.eipLocal,
        context.opcodeOffset + 1,
        context.addressLocal,
        context.byteLocal
      );
      emitOpcodeDispatchNode(
        child,
        {
          ...context,
          opcodeOffset: context.opcodeOffset + 1,
          instructionDoneLabelDepth: context.instructionDoneLabelDepth + 1 + index
        }
      );
      context.body.localGet(context.opcodeLocal);
      emitExitResultFromStackPayload(context.body, ExitReason.UNSUPPORTED).returnFromFunction();
    }
  }

  context.body.endBlock();
  context.body.localGet(context.opcodeLocal);
  emitExitResultFromStackPayload(context.body, ExitReason.UNSUPPORTED).returnFromFunction();
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
