import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "#x86/state/cpu-state.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { runJitIrBlock } from "./helpers.js";

const startAddress = 0x1000;

test("jit register state feeds later instructions from committed register locals", async () => {
  const result = await runJitIrBlock(
    [
      0xb8, 0x23, 0x01, 0x00, 0x00, // mov eax, 0x123
      0x89, 0xc3, // mov ebx, eax
      0x83, 0xc3, 0x01, // add ebx, 1
      0xcd, 0x2e // int 0x2e
    ],
    createCpuState({
      eax: 0xffff_ffff,
      ebx: 0xeeee_eeee,
      eip: startAddress,
      instructionCount: 20
    })
  );

  strictEqual(result.state.eax, 0x123);
  strictEqual(result.state.ebx, 0x124);
  strictEqual(result.state.instructionCount, 24);
  strictEqual(result.state.eip, startAddress + 12);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit register exit states store committed registers on a later memory fault", async () => {
  const result = await runJitIrBlock(
    [
      0xb8, 0x11, 0x11, 0x11, 0x11, // mov eax, 0x11111111
      0xbb, 0x22, 0x22, 0x22, 0x22, // mov ebx, 0x22222222
      0x89, 0x05, 0x00, 0x00, 0x01, 0x00, // mov [0x10000], eax
      0xb9, 0x33, 0x33, 0x33, 0x33 // mov ecx, 0x33333333
    ],
    createCpuState({
      eax: 0xaaaa_aaaa,
      ebx: 0xbbbb_bbbb,
      ecx: 0xcccc_cccc,
      eflags: 0xabcd_0000,
      eip: startAddress,
      instructionCount: 40
    })
  );

  deepStrictEqual(result.exit, { exitReason: ExitReason.MEMORY_WRITE_FAULT, payload: 0x10000 });
  strictEqual(result.state.eax, 0x1111_1111);
  strictEqual(result.state.ebx, 0x2222_2222);
  strictEqual(result.state.ecx, 0xcccc_cccc);
  strictEqual(result.state.eflags, 0xabcd_0000);
  strictEqual(result.state.eip, startAddress + 10);
  strictEqual(result.state.instructionCount, 42);
});
