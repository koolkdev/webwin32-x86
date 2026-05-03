import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { ExitReason } from "#backends/wasm/exit.js";
import { createWasmHostMemories, type WasmHostMemories } from "#backends/wasm/host/memories.js";
import { jitModuleLinkFallbackExportName } from "#backends/wasm/jit/compiled-blocks/module-link-table.js";
import type { WasmCompiledBlockCodeMap } from "#backends/wasm/jit/compiled-blocks/block-cache.js";
import { WasmCompiledBlockCache } from "#backends/wasm/jit/compiled-blocks/wasm-cache.js";
import type { WasmBlockHandle } from "#backends/wasm/jit/block-handle.js";
import {
  GuestMemoryDecodeReader,
  type GuestMemoryDecodeRegion
} from "#x86/isa/decoder/guest-memory-reader.js";

const aEip = 0x1000;
const bEip = 0x2000;
const cEip = 0x3000;

test("cold final static jmp uses module-local fallback stub", () => {
  const fixture = createLinkingFixture([
    block(aEip, incEaxJmpRel32(aEip, bEip)),
    block(bEip, incEaxHostTrap())
  ]);
  const a = compileBlock(fixture, aEip);
  const slot = slotForTarget(a, bEip);
  const stub = exportedFunction(a, jitModuleLinkFallbackExportName(bEip));

  strictEqual(a.moduleLinkTable?.table.length, 1);
  throws(() => a.moduleLinkTable?.table.grow(1), /maximum|grow/i);
  strictEqual(a.moduleLinkTable?.table.get(slot), stub);

  fixture.memories.state.load({ eip: aEip });

  const run = a.run();
  const state = fixture.memories.state.snapshot();

  deepStrictEqual(run.exit, { exitReason: ExitReason.JUMP, payload: bEip });
  strictEqual(state.eip, bEip);
  strictEqual(state.eax, 1);
});

test("compiled target patches dependent module-local table", () => {
  const fixture = createLinkingFixture([
    block(aEip, incEaxJmpRel32(aEip, bEip)),
    block(bEip, incEaxHostTrap())
  ]);
  const a = compileBlock(fixture, aEip);
  const b = compileBlock(fixture, bEip);
  const slot = slotForTarget(a, bEip);

  strictEqual(a.moduleLinkTable?.table.get(slot), b.exportedBlockFunctionForEip(bEip));

  fixture.memories.state.load({ eip: aEip });

  const run = a.run();
  const state = fixture.memories.state.snapshot();

  deepStrictEqual(run.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
  strictEqual(state.eax, 2);
});

test("final jmp rel8 can link through the module-local table", () => {
  const rel8A = 0x1100;
  const rel8B = 0x1108;
  const fixture = createLinkingFixture([
    block(rel8A, incEaxJmpRel8(rel8A, rel8B)),
    block(rel8B, incEaxHostTrap())
  ]);
  const a = compileBlock(fixture, rel8A);
  const b = compileBlock(fixture, rel8B);
  const slot = slotForTarget(a, rel8B);

  strictEqual(a.moduleLinkTable?.table.get(slot), b.exportedBlockFunctionForEip(rel8B));

  fixture.memories.state.load({ eip: rel8A });

  const run = a.run();
  const state = fixture.memories.state.snapshot();

  deepStrictEqual(run.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
  strictEqual(state.eax, 2);
});

test("invalidating compiled target restores dependent module-local fallback", () => {
  const fixture = createLinkingFixture([
    block(aEip, incEaxJmpRel32(aEip, bEip)),
    block(bEip, incEaxHostTrap())
  ]);
  const a = compileBlock(fixture, aEip);
  compileBlock(fixture, bEip);

  fixture.cache.invalidate(bEip);

  const slot = slotForTarget(a, bEip);
  const stub = exportedFunction(a, jitModuleLinkFallbackExportName(bEip));

  strictEqual(a.moduleLinkTable?.table.get(slot), stub);

  fixture.memories.state.load({ eip: aEip });

  const run = a.run();
  const state = fixture.memories.state.snapshot();

  deepStrictEqual(run.exit, { exitReason: ExitReason.JUMP, payload: bEip });
  strictEqual(state.eip, bEip);
  strictEqual(state.eax, 1);
});

test("target compile and invalidation patch multiple dependent module tables", () => {
  const fixture = createLinkingFixture([
    block(aEip, incEaxJmpRel32(aEip, bEip)),
    block(bEip, incEaxHostTrap()),
    block(cEip, incEaxJmpRel32(cEip, bEip))
  ]);
  const a = compileBlock(fixture, aEip);
  const c = compileBlock(fixture, cEip);
  const b = compileBlock(fixture, bEip);
  const aSlot = slotForTarget(a, bEip);
  const cSlot = slotForTarget(c, bEip);

  strictEqual(a.moduleLinkTable?.table.get(aSlot), b.exportedBlockFunctionForEip(bEip));
  strictEqual(c.moduleLinkTable?.table.get(cSlot), b.exportedBlockFunctionForEip(bEip));

  fixture.memories.state.load({ eip: aEip });
  deepStrictEqual(a.run().exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
  strictEqual(fixture.memories.state.snapshot().eax, 2);

  fixture.memories.state.load({ eip: cEip });
  deepStrictEqual(c.run().exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
  strictEqual(fixture.memories.state.snapshot().eax, 2);

  fixture.cache.invalidate(bEip);

  strictEqual(a.moduleLinkTable?.table.get(aSlot), exportedFunction(a, jitModuleLinkFallbackExportName(bEip)));
  strictEqual(c.moduleLinkTable?.table.get(cSlot), exportedFunction(c, jitModuleLinkFallbackExportName(bEip)));

  fixture.memories.state.load({ eip: cEip });
  deepStrictEqual(c.run().exit, { exitReason: ExitReason.JUMP, payload: bEip });
  strictEqual(fixture.memories.state.snapshot().eax, 1);
});

function createLinkingFixture(blocks: readonly TestBlock[]): Readonly<{
  cache: WasmCompiledBlockCache;
  codeMap: WasmCompiledBlockCodeMap;
  memories: WasmHostMemories;
}> {
  const memories = createWasmHostMemories();
  const regions: GuestMemoryDecodeRegion[] = [];

  for (const testBlock of blocks) {
    regions.push({
      kind: "guest-memory",
      baseAddress: testBlock.eip,
      byteLength: testBlock.bytes.length
    });
    writeGuestBytes(memories, testBlock.eip, testBlock.bytes);
  }

  return {
    cache: new WasmCompiledBlockCache(),
    codeMap: {
      createReader: (memory) => new GuestMemoryDecodeReader(memory, regions)
    },
    memories
  };
}

function compileBlock(fixture: ReturnType<typeof createLinkingFixture>, eip: number): WasmBlockHandle {
  const handle = fixture.cache.getOrCompile(eip, fixture.codeMap, fixture.memories);

  ok(handle, `expected block at 0x${eip.toString(16)} to compile`);

  return handle as WasmBlockHandle;
}

function slotForTarget(handle: WasmBlockHandle, targetEip: number): number {
  const table = handle.moduleLinkTable;

  ok(table, `expected module link table for target 0x${targetEip.toString(16)}`);
  return table.slotForTargetEip(targetEip);
}

function exportedFunction(handle: WasmBlockHandle, name: string): () => unknown {
  const value = handle.instance.exports[name];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${name}'`);
  }

  return value as () => unknown;
}

function writeGuestBytes(memories: WasmHostMemories, eip: number, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    const write = memories.guest.writeU8(eip + index, bytes[index] ?? 0);

    if (!write.ok) {
      throw new Error(`failed to write guest byte at 0x${(eip + index).toString(16)}`);
    }
  }
}

function block(eip: number, bytes: readonly number[]): TestBlock {
  return { eip, bytes };
}

function incEaxJmpRel32(blockEip: number, targetEip: number): readonly number[] {
  return [
    0x40,
    ...jmpRel32(blockEip + 1, targetEip)
  ];
}

function incEaxJmpRel8(blockEip: number, targetEip: number): readonly number[] {
  return [
    0x40,
    ...jmpRel8(blockEip + 1, targetEip)
  ];
}

function incEaxHostTrap(): readonly number[] {
  return [
    0x40,
    0xcd, 0x2e
  ];
}

function jmpRel8(eip: number, targetEip: number): readonly number[] {
  const displacement = targetEip - (eip + 2);

  if (displacement < -128 || displacement > 127) {
    throw new RangeError(`rel8 displacement out of range: ${displacement}`);
  }

  return [
    0xeb,
    displacement & 0xff
  ];
}

function jmpRel32(eip: number, targetEip: number): readonly number[] {
  const displacement = targetEip - (eip + 5);

  return [
    0xe9,
    displacement & 0xff,
    (displacement >> 8) & 0xff,
    (displacement >> 16) & 0xff,
    (displacement >> 24) & 0xff
  ];
}

type TestBlock = Readonly<{
  eip: number;
  bytes: readonly number[];
}>;
