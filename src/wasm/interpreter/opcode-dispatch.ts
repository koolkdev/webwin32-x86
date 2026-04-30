import type { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { dispatchBytes, interpreterOpcodeDispatchRoot } from "./dispatch.js";
import { emitWasmSirExitFromI32Stack, type WasmSirExitTarget } from "../sir/exit.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import { emitInstructionHandlerForLeaf } from "./instruction-handlers.js";
import type { InterpreterStateCache } from "./state-cache.js";

type OpcodeDispatchContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  state: InterpreterStateCache;
  exit: WasmSirExitTarget;
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
  state: InterpreterStateCache,
  exit: WasmSirExitTarget,
  opcodeOffset: number,
  byteLocal: number,
  addressLocal: number,
  opcodeLocal: number,
  scratch: WasmLocalScratchAllocator
): void {
  body.localGet(byteLocal).localSet(opcodeLocal);
  emitOpcodeDispatchNode(interpreterOpcodeDispatchRoot, {
    body,
    state,
    exit,
    eipLocal: state.eipLocal,
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
    emitUnsupportedOpcodeExit(context);
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

    const caseContext = {
      ...context,
      instructionDoneLabelDepth: context.instructionDoneLabelDepth + 1 + index,
      exit: {
        ...context.exit,
        exitLabelDepth: context.exit.exitLabelDepth + 1 + index
      }
    };

    if (child.leaf !== undefined) {
      const emitted = emitInstructionHandlerForLeaf(child.leaf, caseContext);

      if (!emitted) {
        emitUnsupportedOpcodeExit(caseContext);
      }
    } else {
      emitLoadGuestByte(
        context.body,
        context.eipLocal,
        context.opcodeOffset + 1,
        context.addressLocal,
        context.byteLocal,
        caseContext.exit
      );
      emitOpcodeDispatchNode(
        child,
        {
          ...caseContext,
          opcodeOffset: context.opcodeOffset + 1
        }
      );
      emitUnsupportedOpcodeExit(caseContext);
    }
  }

  context.body.endBlock();
  emitUnsupportedOpcodeExit(context);
}

function emitUnsupportedOpcodeExit(context: OpcodeDispatchContext): void {
  context.body.localGet(context.opcodeLocal);
  emitWasmSirExitFromI32Stack(context.body, context.exit, ExitReason.UNSUPPORTED);
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
