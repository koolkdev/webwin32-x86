import type { RunResult } from "../../../x86/execution/run-result.js";
import type { CpuState } from "../../../x86/state/cpu-state.js";

export type MemoryPatch = Readonly<{
  address: number;
  bytes: readonly number[];
}>;

export type EngineFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  initialState: Partial<CpuState>;
  initialMemory?: readonly MemoryPatch[];
  expected: EngineExpectation;
}>;

export type EngineExpectation = Readonly<{
  result: Partial<RunResult> & Pick<RunResult, "stopReason">;
  state: Partial<CpuState>;
  memory?: readonly MemoryPatch[];
}>;
