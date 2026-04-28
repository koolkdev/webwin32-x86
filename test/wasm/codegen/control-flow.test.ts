import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeBlock, type DecodedBlock } from "../../../src/arch/x86/block-decoder/decode-block.js";
import {
  cloneCpuState,
  cpuStatesEqual,
  createCpuState,
  type CpuState
} from "../../../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../../src/interp/interpreter.js";
import { guestReader } from "../../../src/test-support/decode-reader.js";
import { ExitReason, type DecodedExit } from "../../../src/wasm/exit.js";
import {
  assertStateEquals,
  compileDecodedWasmBlock,
  decodeBytes,
  copyStateFromView,
  compileAndRunBlock,
  readCpuState,
  startAddress,
  type CompiledWasmBlock
} from "../../../src/test-support/wasm-codegen.js";
import { hostAddress } from "../../../src/test-support/x86-code.js";

test("jit_jmp_exit_target", async () => {
  const bytes = [0xeb, 0x03];
  const { wasmExit, wasmState, interpreterState } = await runBranchFixture(bytes, createCpuState({ eip: startAddress }));

  strictEqual(wasmExit.exitReason, ExitReason.JUMP);
  strictEqual(wasmExit.payload, interpreterState.eip);
  strictEqual(wasmState.eip, interpreterState.eip);
  strictEqual(wasmState.instructionCount, interpreterState.instructionCount);
});

test("jit_cmp_jz_taken_exit", async () => {
  const bytes = [0x83, 0xf8, 0x00, 0x74, 0x02];
  const { wasmExit, wasmState, interpreterState } = await runBranchFixture(
    bytes,
    createCpuState({ eax: 0, eip: startAddress })
  );

  strictEqual(wasmExit.exitReason, ExitReason.BRANCH_TAKEN);
  strictEqual(wasmExit.payload, interpreterState.eip);
  ok(cpuStatesEqual(wasmState, interpreterState));
});

test("jit_cmp_jz_not_taken_exit", async () => {
  const bytes = [0x83, 0xf8, 0x00, 0x74, 0x02];
  const { wasmExit, wasmState, interpreterState } = await runBranchFixture(
    bytes,
    createCpuState({ eax: 1, eip: startAddress })
  );

  strictEqual(wasmExit.exitReason, ExitReason.BRANCH_NOT_TAKEN);
  strictEqual(wasmExit.payload, interpreterState.eip);
  ok(cpuStatesEqual(wasmState, interpreterState));
});

test("jit_sub_imm8_jnz_loop_runtime_exits_match_interpreter", async (t) => {
  const bytes = [
    0x83, 0xe8, 0x01,
    0x83, 0xf8, 0x00,
    0x75, 0xf8
  ];
  const interpreterState = createCpuState({ eax: 3, eip: startAddress });
  const interpreterResult = runInstructionInterpreter(interpreterState, decodeBytes(bytes));
  const wasm = await runWasmRegion(bytes, createCpuState({ eax: 3, eip: startAddress }));

  ok(cpuStatesEqual(wasm.state, interpreterState));
  strictEqual(wasm.state.stopReason, interpreterResult.stopReason);
  t.diagnostic(`wasm control-flow exits: ${wasm.exitCount}`);
});

test("jit_host_call_exit_from_metadata", async () => {
  const initialState = createCpuState({ eax: 0x1234_5678, eip: hostAddress, instructionCount: 7 });
  const block = await compileDecodedWasmBlock(hostCallBlock());
  const result = await block.run(initialState);

  strictEqual(result.exit.exitReason, ExitReason.HOST_CALL);
  strictEqual(result.exit.payload, 9);
  assertStateEquals(result.stateView, initialState);
});

async function runBranchFixture(
  bytes: readonly number[],
  initialState: CpuState
): Promise<Readonly<{ wasmExit: DecodedExit; wasmState: CpuState; interpreterState: CpuState }>> {
  const interpreterState = cloneCpuState(initialState);
  runInstructionInterpreter(interpreterState, decodeBytes(bytes));

  const wasmResult = await compileAndRunBlock(bytes, initialState);
  const wasmState = readCpuState(wasmResult.stateView);

  return {
    wasmExit: wasmResult.exit,
    wasmState,
    interpreterState
  };
}

async function runWasmRegion(
  bytes: readonly number[],
  initialState: CpuState
): Promise<Readonly<{ state: CpuState; exitCount: number }>> {
  const reader = guestReader(bytes);
  const compiledBlocks = new Map<number, CompiledWasmBlock>();
  const state = cloneCpuState(initialState);
  let exitCount = 0;

  for (let steps = 0; steps < 32; steps += 1) {
    if (reader.regionAt(state.eip) === undefined) {
      return { state, exitCount };
    }

    const block = decodeBlock(reader, state.eip);
    const compiledBlock = await compiledBlockFor(compiledBlocks, block);
    const result = await compiledBlock.run(state);

    copyStateFromView(result.stateView, state);
    exitCount += 1;

    if (!isControlFlowExit(result.exit)) {
      return { state, exitCount };
    }
  }

  throw new Error("wasm control-flow fixture did not terminate");
}

async function compiledBlockFor(
  compiledBlocks: Map<number, CompiledWasmBlock>,
  block: DecodedBlock
): Promise<CompiledWasmBlock> {
  let compiled = compiledBlocks.get(block.startEip);

  if (compiled === undefined) {
    compiled = await compileDecodedWasmBlock(block);
    compiledBlocks.set(block.startEip, compiled);
  }

  return compiled;
}

function hostCallBlock(): DecodedBlock {
  return {
    startEip: hostAddress,
    instructions: [],
    terminator: {
      kind: "host-call",
      eip: hostAddress,
      hostCallId: 9,
      name: "test.host",
      convention: "stdcall"
    }
  };
}

function isControlFlowExit(exit: DecodedExit): boolean {
  return (
    exit.exitReason === ExitReason.FALLTHROUGH ||
    exit.exitReason === ExitReason.JUMP ||
    exit.exitReason === ExitReason.BRANCH_TAKEN ||
    exit.exitReason === ExitReason.BRANCH_NOT_TAKEN
  );
}
