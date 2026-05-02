import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { encodeExit } from "../exit.js";
import { emitWasmIrExitConstPayload, type WasmIrExitTarget } from "../lowering/exit.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import { emitOpcodeDispatch } from "./opcode-dispatch.js";
import {
  createInterpreterStateCache,
  emitFlushInterpreterStateCache,
  emitLoadInterpreterStateCache
} from "./state-cache.js";

const fuelParam = 0;

export function encodeInterpreterModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const stateMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.stateMemoryName, { minPages: 1 });
  const guestMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.guestMemoryName, { minPages: 1 });

  if (stateMemoryIndex !== wasmMemoryIndex.state || guestMemoryIndex !== wasmMemoryIndex.guest) {
    throw new Error("unexpected Wasm memory import order");
  }

  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder(1);
  const eipLocal = body.addLocal(wasmValueType.i32);
  const byteLocal = body.addLocal(wasmValueType.i32);
  const addressLocal = body.addLocal(wasmValueType.i32);
  const opcodeLocal = body.addLocal(wasmValueType.i32);
  const exitLocal = body.addLocal(wasmValueType.i64);
  const state = createInterpreterStateCache(body, eipLocal);
  const exit: WasmIrExitTarget = { exitLocal, exitLabelDepth: 2 };
  const scratch = new WasmLocalScratchAllocator(body);

  emitLoadInterpreterStateCache(body, state);
  body.i64Const(encodeExit(ExitReason.INSTRUCTION_LIMIT, 0)).localSet(exitLocal);

  body.block();
  body.loop();
  body.localGet(fuelParam).i32Eqz().ifBlock();
  emitWasmIrExitConstPayload(body, { ...exit, exitLabelDepth: 2 }, ExitReason.INSTRUCTION_LIMIT, 0);
  body.endBlock();

  body.block();
  emitLoadGuestByte(body, eipLocal, 0, addressLocal, byteLocal, exit);
  emitOpcodeDispatch(body, state, exit, 0, byteLocal, addressLocal, opcodeLocal, scratch);
  body.endBlock();
  body.localGet(fuelParam).i32Const(1).i32Sub().localSet(fuelParam);
  body.br(0);

  body.endBlock();
  body.endBlock();
  emitFlushInterpreterStateCache(body, state);
  body.localGet(exitLocal).returnFromFunction();
  scratch.assertClear();
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

  return module.encode();
}
