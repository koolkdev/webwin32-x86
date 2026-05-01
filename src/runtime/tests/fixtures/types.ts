import type { RunResult } from "../../../core/execution/run-result.js";
import type { CpuState } from "../../../core/state/cpu-state.js";

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
