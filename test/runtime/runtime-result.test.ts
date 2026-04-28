import { strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { guestReader, TestDecodeReader } from "../../src/test-support/decode-reader.js";
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

test("runtime_state_available_after_run", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(movAddFixture),
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(runtime.state.eax, 3);
  strictEqual(runtime.state.eip, result.finalEip);
  strictEqual(runtime.state.instructionCount, result.instructionCount);
});

test("run_result_instruction_limit_reason", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress }
  });
  const result = runtime.run({ instructionLimit: 4 });

  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.instructionCount, 4);
  strictEqual(runtime.state.stopReason, StopReason.INSTRUCTION_LIMIT);
});

test("run_result_decode_fault_reason", () => {
  const runtime = new RuntimeInstance({
    decodeReader: new TestDecodeReader([]),
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.DECODE_FAULT);
  strictEqual(result.faultAddress, startAddress);
  strictEqual(result.faultOperation, "execute");
});

test("run_result_unsupported_x86_reason", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader([0x62]),
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.unsupportedByte, 0x62);
  strictEqual(result.unsupportedReason, "unsupportedOpcode");
});

test("internal_counters_not_guest_stop_reasons", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(runtime.counters.decodedBlockCache.hits, 2);
  strictEqual(runtime.counters.decodedBlockCache.misses, 2);
});

test("run_result_shape_has_no_metrics_payload", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(movAddFixture),
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual("counters" in result, false);
  strictEqual("events" in result, false);
  strictEqual("finalState" in result, false);
});
