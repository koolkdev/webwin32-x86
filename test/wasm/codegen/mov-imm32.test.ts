import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import type { Reg32 } from "../../../src/arch/x86/instruction/types.js";
import { createCpuState } from "../../../src/core/state/cpu-state.js";
import { ExitReason } from "../../../src/wasm/exit.js";
import {
  assertMemoryImports,
  assertWasmMatchesInterpreter,
  compileWasmBlock,
  readStateU32,
  compileAndRunBlock,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";

test("jit_mov_eax_imm32", async () => {
  const block = await compileWasmBlock([0xb8, 0x78, 0x56, 0x34, 0x12]);
  const result = await block.run(createCpuState({ eip: startAddress }));

  assertMemoryImports(block.module);
  strictEqual(readStateU32(result.stateView, "eax"), 0x1234_5678);
  strictEqual(readStateU32(result.stateView, "eip"), 0x1005);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
  deepStrictEqual(result.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1005
  });
});

test("jit_mov_edi_imm32", async () => {
  const result = await compileAndRunBlock([0xbf, 0xff, 0xff, 0xff, 0xff]);

  strictEqual(readStateU32(result.stateView, "edi"), 0xffff_ffff);
  strictEqual(readStateU32(result.stateView, "eip"), 0x1005);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
  deepStrictEqual(result.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1005
  });
});

test("jit_matches_interpreter_mov", async () => {
  const fixtures: readonly MovFixture[] = [
    { bytes: [0xb8, 0x78, 0x56, 0x34, 0x12], reg: "eax" },
    { bytes: [0xbf, 0xff, 0xff, 0xff, 0xff], reg: "edi" }
  ];

  for (const fixture of fixtures) {
    const { wasmResult, interpreterState } = await assertWasmMatchesInterpreter(
      fixture.bytes,
      createCpuState({ eip: startAddress })
    );

    strictEqual(readStateU32(wasmResult.stateView, fixture.reg), interpreterState[fixture.reg]);
    strictEqual(readStateU32(wasmResult.stateView, "eip"), interpreterState.eip);
    strictEqual(readStateU32(wasmResult.stateView, "instructionCount"), interpreterState.instructionCount);
  }
});

type MovFixture = Readonly<{
  bytes: readonly number[];
  reg: Reg32;
}>;
