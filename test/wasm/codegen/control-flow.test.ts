import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import {
  cloneCpuState,
  cpuStatesEqual,
  createCpuState,
  type CpuState
} from "../../../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../../src/interp/interpreter.js";
import { ExitReason, type DecodedExit } from "../../../src/wasm/exit.js";
import {
  decodeBytes,
  compileAndRunBlock,
  readCpuState,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";

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
