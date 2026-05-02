import { strictEqual } from "node:assert";

import { decodeIsaBlock } from "../../../x86/isa/decoder/decode-block.js";
import type { RunResult } from "../../../x86/execution/run-result.js";
import type { CpuStateField } from "../../../x86/state/cpu-state.js";
import { wasmBlockExportName, wasmImport } from "../../../wasm/abi.js";
import { UnsupportedWasmCodegenError } from "../../../wasm/errors.js";
import { decodeExit } from "../../../wasm/exit.js";
import { readInterpreterWasmArtifact } from "../../../wasm/interpreter/artifact.js";
import type { CompiledBlockCache } from "../../compiled-blocks/block-cache.js";
import { WasmBlocksEngine } from "../../engines/wasm-blocks.js";
import { WasmInterpreterEngine, type WasmInterpreter } from "../../engines/wasm-interpreter.js";
import { engineUnavailable, type RuntimeEngineResult } from "../../execution/engine-result.js";
import type { RuntimeEngines } from "../../execution/runner.js";
import { RuntimeCodeMap } from "../../program/code-map.js";
import { loadProgramRegions } from "../../program/loader.js";
import { codeRegionsFromProgram, type RuntimeProgramRegion } from "../../program/regions.js";
import { compileWasmBlockHandle } from "../../wasm-block/wasm-block.js";
import type { RuntimeWasmMemories } from "../../wasm/memories.js";
import { createRuntimeWasmMemories } from "../../wasm/memories.js";
import { engineFixtureStartAddress } from "./programs.js";
import type { EngineFixture, MemoryPatch } from "./types.js";

export type PreparedEngineFixture = Readonly<{
  codeMap: RuntimeCodeMap;
  memories: RuntimeWasmMemories;
}>;

let interpreterModule: WebAssembly.Module | undefined;

export function prepareEngineFixture(fixture: EngineFixture): PreparedEngineFixture {
  const memories = createRuntimeWasmMemories();
  const programRegion: RuntimeProgramRegion = {
    baseAddress: engineFixtureStartAddress,
    bytes: fixture.bytes
  };

  writeMemoryPatches(memories, fixture.initialMemory ?? []);

  const fault = loadProgramRegions(memories.guest, [programRegion]);

  if (fault !== undefined) {
    throw new Error(`failed to load fixture code at 0x${fault.faultAddress.toString(16)}`);
  }

  memories.state.load(fixture.initialState);

  return {
    codeMap: new RuntimeCodeMap(codeRegionsFromProgram([programRegion])),
    memories
  };
}

export function instantiateFixtureWasmInterpreter(memories: RuntimeWasmMemories): WasmInterpreter {
  interpreterModule ??= new WebAssembly.Module(readInterpreterWasmArtifact());

  const instance = new WebAssembly.Instance(interpreterModule, {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: memories.stateMemory,
      [wasmImport.guestMemoryName]: memories.guestMemory
    }
  });
  const run = instance.exports[wasmBlockExportName];

  if (typeof run !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  return {
    run(fuel) {
      return decodeExit((run as (fuel: number) => bigint)(fuel));
    }
  };
}

export function createFixtureCompiledBlockCache(): CompiledBlockCache {
  return {
    getOrCompile(startEip, codeMap, memories) {
      const block = decodeIsaBlock(codeMap.createReader(memories.guest), startEip, {
        maxInstructions: 1024
      });

      if (block.instructions.length === 0) {
        return undefined;
      }

      try {
        return compileWasmBlockHandle(block, {
          stateMemory: memories.stateMemory,
          guestMemory: memories.guestMemory,
          blockKey: startEip
        });
      } catch (error: unknown) {
        if (error instanceof UnsupportedWasmCodegenError) {
          return undefined;
        }

        throw error;
      }
    }
  };
}

export function createFixtureRuntimeEngines(memories: RuntimeWasmMemories): RuntimeEngines {
  return {
    interpreter: new WasmInterpreterEngine(instantiateFixtureWasmInterpreter(memories)),
    compiledBlocks: new WasmBlocksEngine(createFixtureCompiledBlockCache())
  };
}

export function createFixtureInterpreterOnlyEngines(memories: RuntimeWasmMemories): RuntimeEngines {
  return {
    interpreter: new WasmInterpreterEngine(instantiateFixtureWasmInterpreter(memories)),
    compiledBlocks: {
      run() {
        throw new Error("compiled-blocks engine should not run in interpreter mode");
      }
    }
  };
}

export function createFixtureFallbackEngines(memories: RuntimeWasmMemories): RuntimeEngines {
  return {
    interpreter: new WasmInterpreterEngine(instantiateFixtureWasmInterpreter(memories)),
    compiledBlocks: {
      run() {
        return engineUnavailable("unsupported-block");
      }
    }
  };
}

export function assertEngineFixtureResult(
  fixture: EngineFixture,
  result: RuntimeEngineResult,
  memories: RuntimeWasmMemories
): void {
  strictEqual(result.kind, "done");

  if (result.kind !== "done") {
    return;
  }

  assertResultFields(fixture, result.result);
  assertStateFields(fixture, memories);
  assertMemoryPatches(memories, fixture.expected.memory ?? []);
}

function assertResultFields(fixture: EngineFixture, actual: RunResult): void {
  for (const [field, expected] of Object.entries(fixture.expected.result)) {
    strictEqual(
      actual[field as keyof typeof actual],
      expected,
      `${fixture.name}: expected result.${field}`
    );
  }
}

function assertStateFields(fixture: EngineFixture, memories: RuntimeWasmMemories): void {
  const actual = memories.state.snapshot();

  for (const [field, expected] of Object.entries(fixture.expected.state)) {
    strictEqual(
      actual[field as CpuStateField],
      expected,
      `${fixture.name}: expected state.${field}`
    );
  }
}

function assertMemoryPatches(memories: RuntimeWasmMemories, patches: readonly MemoryPatch[]): void {
  for (const patch of patches) {
    for (let index = 0; index < patch.bytes.length; index += 1) {
      const address = patch.address + index;
      const read = memories.guest.readU8(address);

      strictEqual(read.ok, true, `expected memory read at 0x${address.toString(16)} to succeed`);

      if (read.ok) {
        strictEqual(read.value, patch.bytes[index] ?? 0, `expected memory byte at 0x${address.toString(16)}`);
      }
    }
  }
}

function writeMemoryPatches(memories: RuntimeWasmMemories, patches: readonly MemoryPatch[]): void {
  for (const patch of patches) {
    for (let index = 0; index < patch.bytes.length; index += 1) {
      const address = patch.address + index;
      const write = memories.guest.writeU8(address, patch.bytes[index] ?? 0);

      if (!write.ok) {
        throw new Error(`failed to write fixture memory at 0x${address.toString(16)}`);
      }
    }
  }
}
