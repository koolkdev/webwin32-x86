import type { CpuState } from "../core/state/cpu-state.js";

export type RawX86FixtureJson = Readonly<{
  id: string;
  bytes: readonly number[];
  loadAddress: number;
  entryEip?: number;
  initialState?: Readonly<Partial<CpuState>>;
  memorySize?: number;
  memory?: readonly Readonly<{
    address: number;
    bytes: readonly number[];
  }>[];
  instructionLimit?: number;
  expectedState?: Readonly<Partial<CpuState>>;
}>;

export type RawX86Fixture = Readonly<{
  id: string;
  bytes: readonly number[];
  loadAddress: number;
  entryEip: number;
  initialState: Readonly<Partial<CpuState>>;
  memorySize?: number;
  memory: readonly Readonly<{
    address: number;
    bytes: readonly number[];
  }>[];
  instructionLimit?: number;
  expectedState: Readonly<Partial<CpuState>>;
}>;

export function rawX86FixtureFromJson(json: RawX86FixtureJson): RawX86Fixture {
  return {
    id: json.id,
    bytes: json.bytes,
    loadAddress: json.loadAddress,
    entryEip: json.entryEip ?? json.loadAddress,
    initialState: json.initialState ?? {},
    ...(json.memorySize === undefined ? {} : { memorySize: json.memorySize }),
    memory: json.memory ?? [],
    ...(json.instructionLimit === undefined ? {} : { instructionLimit: json.instructionLimit }),
    expectedState: json.expectedState ?? {}
  };
}
