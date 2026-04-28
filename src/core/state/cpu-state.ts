import { reg32, type Reg32 } from "../../arch/x86/instruction/types.js";

export type CpuFlag = "CF" | "PF" | "AF" | "ZF" | "SF" | "OF";

export type CpuState = {
  [Register in Reg32]: number;
} & {
  eip: number;
  eflags: number;
  instructionCount: number;
  stopReason: number;
};

export const STATE_OFFSETS = {
  eax: 0,
  ecx: 4,
  edx: 8,
  ebx: 12,
  esp: 16,
  ebp: 20,
  esi: 24,
  edi: 28,
  eip: 32,
  eflags: 36,
  instructionCount: 40,
  stopReason: 44
} as const;

export const STATE_BYTE_LENGTH = 48;

export const cpuFlags = ["CF", "PF", "AF", "ZF", "SF", "OF"] as const satisfies readonly CpuFlag[];

export const eflagsMask = {
  CF: 1 << 0,
  PF: 1 << 2,
  AF: 1 << 4,
  ZF: 1 << 6,
  SF: 1 << 7,
  OF: 1 << 11
} as const satisfies Readonly<Record<CpuFlag, number>>;

export const supportedEflagsMask = cpuFlags.reduce((mask, flag) => mask | eflagsMask[flag], 0) >>> 0;

export const cpuStateFields = [...reg32, "eip", "eflags", "instructionCount", "stopReason"] as const satisfies readonly (keyof CpuState)[];
export type CpuStateField = (typeof cpuStateFields)[number];

export function createCpuState(overrides: Partial<CpuState> = {}): CpuState {
  return normalizeCpuState({
    eax: 0,
    ecx: 0,
    edx: 0,
    ebx: 0,
    esp: 0,
    ebp: 0,
    esi: 0,
    edi: 0,
    eip: 0,
    eflags: 0,
    instructionCount: 0,
    stopReason: 0,
    ...overrides
  });
}

export function getReg32(state: CpuState, reg: Reg32): number {
  return state[reg] >>> 0;
}

export function setReg32(state: CpuState, reg: Reg32, value: number): void {
  state[reg] = u32(value);
}

export function getFlag(state: CpuState, flag: CpuFlag): boolean {
  return (state.eflags & eflagsMask[flag]) !== 0;
}

export function setFlag(state: CpuState, flag: CpuFlag, value: boolean): void {
  const mask = eflagsMask[flag];
  state.eflags = value ? u32(state.eflags | mask) : u32(state.eflags & ~mask);
}

export function u32(value: number): number {
  return value >>> 0;
}

export function i32(value: number): number {
  return value | 0;
}

export function hasEvenParityLowByte(value: number): boolean {
  let remaining = value & 0xff;
  let isEven = true;

  while (remaining !== 0) {
    isEven = !isEven;
    remaining &= remaining - 1;
  }

  return isEven;
}

export function cloneCpuState(state: CpuState): CpuState {
  return createCpuState(state);
}

export function copyCpuState(source: CpuState, target: CpuState): void {
  for (const field of cpuStateFields) {
    target[field] = u32(source[field]);
  }
}

export function cpuStatesEqual(left: CpuState, right: CpuState): boolean {
  return cpuStateFields.every((field) => u32(left[field]) === u32(right[field]));
}

function normalizeCpuState(state: CpuState): CpuState {
  for (const field of cpuStateFields) {
    state[field] = u32(state[field]);
  }

  return state;
}
