import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";

export type WasmFeatureName = "multi-memory" | "i64-return-bigint" | "imported-memory-sharing";

export type WasmFeatureCheck =
  | Readonly<{ feature: WasmFeatureName; supported: true }>
  | Readonly<{ feature: WasmFeatureName; supported: false; message: string }>;

export type WasmFeatureReport = Readonly<{
  checks: readonly WasmFeatureCheck[];
  missingFeatures: readonly Extract<WasmFeatureCheck, { supported: false }>[];
  baselineJitAvailable: boolean;
  interpreterAvailable: true;
  decodedBlockRuntimeAvailable: true;
}>;

const importNamespace = "webwin32";
const stateImportName = "state";
const guestImportName = "guest";
const stateEaxOffset = 0;
const statePtr = 32;
const expectedI64Payload = 0x1234_5678;
const expectedI64ExitReason = 6;
const expectedStoredValue = 0x1234_5678;

export async function probeWasmFeatures(): Promise<WasmFeatureReport> {
  const checks: WasmFeatureCheck[] = [];

  checks.push(await runFeatureCheck("multi-memory", probeMultiMemory));
  checks.push(await runFeatureCheck("i64-return-bigint", probeI64ReturnBigInt));
  checks.push(await runFeatureCheck("imported-memory-sharing", probeImportedMemorySharing));

  const missingFeatures = checks.filter((check): check is Extract<WasmFeatureCheck, { supported: false }> => {
    return !check.supported;
  });

  return {
    checks,
    missingFeatures,
    baselineJitAvailable: missingFeatures.length === 0,
    interpreterAvailable: true,
    decodedBlockRuntimeAvailable: true
  };
}

async function runFeatureCheck(
  feature: WasmFeatureName,
  probe: () => Promise<void>
): Promise<WasmFeatureCheck> {
  try {
    await probe();
    return { feature, supported: true };
  } catch (error: unknown) {
    return {
      feature,
      supported: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probeMultiMemory(): Promise<void> {
  const state = new WebAssembly.Memory({ initial: 1 });
  const guest = new WebAssembly.Memory({ initial: 1 });
  const guestAddress = 16;
  const expectedValue = 0x1234_5678;

  new DataView(guest.buffer).setUint32(guestAddress, expectedValue, true);

  const instance = await instantiateProbeModule(encodeGuestLoadProbeModule(), state, guest);
  const loadGuest = readExportedFunction(instance, "loadGuest");
  const actual = loadGuest(guestAddress);

  if (actual !== expectedValue) {
    throw new Error(`memory 1 load returned ${String(actual)}, expected ${expectedValue}`);
  }
}

async function probeI64ReturnBigInt(): Promise<void> {
  const encoded = (BigInt(expectedI64ExitReason) << 32n) | BigInt(expectedI64Payload);
  const instance = await instantiateProbeModule(encodeI64ReturnProbeModule(encoded));
  const encodedExit = readExportedFunction(instance, "encodedExit");
  const result: unknown = encodedExit();

  if (typeof result !== "bigint") {
    throw new Error(`i64 return produced ${typeof result}, expected bigint`);
  }

  const payload = Number(result & 0xffff_ffffn) >>> 0;
  const exitReason = Number((result >> 32n) & 0xffffn);

  if (payload !== expectedI64Payload || exitReason !== expectedI64ExitReason) {
    throw new Error(`i64 return decoded to payload ${payload}, exit reason ${exitReason}`);
  }
}

async function probeImportedMemorySharing(): Promise<void> {
  const state = new WebAssembly.Memory({ initial: 1 });
  const instance = await instantiateProbeModule(encodeStateStoreProbeModule(), state);
  const storeState = readExportedFunction(instance, "storeState");

  storeState(statePtr);

  const actual = new DataView(state.buffer).getUint32(statePtr + stateEaxOffset, true);

  if (actual !== expectedStoredValue) {
    throw new Error(`state memory value ${actual}, expected ${expectedStoredValue}`);
  }
}

async function instantiateProbeModule(
  bytes: Uint8Array<ArrayBuffer>,
  state?: WebAssembly.Memory,
  guest?: WebAssembly.Memory
): Promise<WebAssembly.Instance> {
  const module = await WebAssembly.compile(bytes);
  const imports =
    state === undefined
      ? undefined
      : {
          [importNamespace]: {
            [stateImportName]: state,
            ...(guest === undefined ? {} : { [guestImportName]: guest })
          }
        };

  return WebAssembly.instantiate(module, imports);
}

function encodeGuestLoadProbeModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  module.importMemory(importNamespace, stateImportName, { minPages: 1 });
  const guestMemoryIndex = module.importMemory(importNamespace, guestImportName, { minPages: 1 });
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder()
    .localGet(0)
    .i32Load({
      align: 2,
      memoryIndex: guestMemoryIndex,
      offset: 0
    })
    .end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction("loadGuest", functionIndex);

  return module.encode();
}

function encodeI64ReturnProbeModule(value: bigint): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [],
    results: [wasmValueType.i64]
  });
  const functionIndex = module.addFunction(typeIndex, new WasmFunctionBodyEncoder().i64Const(value).end());

  module.exportFunction("encodedExit", functionIndex);

  return module.encode();
}

function encodeStateStoreProbeModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const stateMemoryIndex = module.importMemory(importNamespace, stateImportName, { minPages: 1 });
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: []
  });
  const body = new WasmFunctionBodyEncoder()
    .localGet(0)
    .i32Const(expectedStoredValue)
    .i32Store({
      align: 2,
      memoryIndex: stateMemoryIndex,
      offset: stateEaxOffset
    })
    .end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction("storeState", functionIndex);

  return module.encode();
}

function readExportedFunction(instance: WebAssembly.Instance, name: string): (...args: number[]) => unknown {
  const value = instance.exports[name];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${name}'`);
  }

  return value as (...args: number[]) => unknown;
}
