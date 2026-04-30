import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import { DecodedBlockCache } from "../../src/runtime/decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner } from "../../src/runtime/decoded-block-runner/decoded-block-runner.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const branchLoopFixture = [
  0x83, 0xe8, 0x01,
  0x83, 0xf8, 0x00,
  0x75, 0xf8,
  0xcd, 0x2e
] as const;

const movAddFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xcd, 0x2e
] as const;

test("dispatch_loop_runs_branch_loop", () => {
  const expected = runT1(branchLoopFixture, { eax: 3, eip: startAddress });
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress }
  });
  const result = runtime.run();

  ok(cpuStatesEqual(runtime.state, expected.state));
  strictEqual(result.stopReason, expected.result.stopReason);
  strictEqual(runtime.state.eax, 0);
  strictEqual(runtime.state.instructionCount, 10);
});

test("dispatch_loop_respects_instruction_limit", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress }
  });
  const result = runtime.run({ instructionLimit: 4 });

  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(runtime.state.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(runtime.state.instructionCount, 4);
});

test("dispatch_loop_stops_on_decode_fault", () => {
  const runtime = new RuntimeInstance({
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.DECODE_FAULT);
  strictEqual(result.faultAddress, startAddress);
  strictEqual(result.faultSize, 0);
  strictEqual(result.faultOperation, "execute");
});

test("dispatch_loop_stops_on_unsupported_x86", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: [0x62] },
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.unsupportedByte, 0x62);
  strictEqual(result.unsupportedReason, "unsupportedOpcode");
});

test("dispatch_loop_uses_wasm_interpreter_without_decoded_block_edges", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress }
  });

  runtime.run();

  strictEqual(runtime.counters.profile.edgeHits.size, 0);
});

test("runtime_run_uses_entry_eip_option", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: movAddFixture },
    initialState: { eip: 0 }
  });
  const result = runtime.run({ entryEip: startAddress });

  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(runtime.state.eax, 3);
});

function runT1(
  bytes: readonly number[],
  initialState: Partial<CpuState>
): Readonly<{ state: CpuState; result: RunResult }> {
  const state = createCpuState(initialState);
  const cache = new DecodedBlockCache(guestReader(bytes));
  const runner = new DecodedBlockRunner(cache);
  const result = runner.run(state);

  return { state, result };
}
