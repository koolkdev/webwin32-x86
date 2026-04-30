import { wasmBlockExportName, wasmImport, wasmMemoryIndex, stateOffset } from "../abi.js";
import { emitExitResult } from "../codegen/exit.js";
import { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import { emitOpcodeDispatch } from "./opcode-dispatch.js";

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
  const scratch = new WasmLocalScratchAllocator(body);

  body.localGet(fuelParam).i32Eqz().ifBlock();
  emitExitResult(body, ExitReason.INSTRUCTION_LIMIT, 0).returnFromFunction();
  body.endBlock();

  body
    .i32Const(0)
    .i32Load({ align: 2, offset: stateOffset.eip, memoryIndex: wasmMemoryIndex.state })
    .localSet(eipLocal);

  emitLoadGuestByte(body, eipLocal, 0, addressLocal, byteLocal);
  emitOpcodeDispatch(body, eipLocal, 0, byteLocal, addressLocal, opcodeLocal, scratch);
  scratch.assertClear();
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

  return module.encode();
}
