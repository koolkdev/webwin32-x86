import { u32 } from "#x86/state/cpu-state.js";

export const ExitReason = {
  FALLTHROUGH: 0,
  JUMP: 1,
  BRANCH_TAKEN: 2,
  BRANCH_NOT_TAKEN: 3,
  HOST_TRAP: 4,
  UNSUPPORTED: 5,
  DECODE_FAULT: 6,
  MEMORY_READ_FAULT: 7,
  MEMORY_WRITE_FAULT: 8,
  INSTRUCTION_LIMIT: 9
} as const;

export type ExitReason = (typeof ExitReason)[keyof typeof ExitReason];

export type DecodedExit = Readonly<{
  exitReason: ExitReason;
  payload: number;
  detail?: number;
}>;

const payloadMask = 0xffff_ffffn;
const exitReasonMask = 0xffffn;
const exitReasonShift = 32n;
const detailMask = 0xffffn;
const detailShift = 48n;
const exitReasons = new Set<number>(Object.values(ExitReason));

export function encodeExit(exitReason: ExitReason, payload: number, detail = 0): bigint {
  assertExitReason(exitReason);
  assertExitDetail(detail);

  return (BigInt(detail) << detailShift) | (BigInt(exitReason) << exitReasonShift) | BigInt(u32(payload));
}

export function decodeExit(value: bigint): DecodedExit {
  const exitReason = Number((value >> exitReasonShift) & exitReasonMask);
  const detail = Number((value >> detailShift) & detailMask);

  assertExitReason(exitReason);

  const decoded = {
    exitReason,
    payload: Number(value & payloadMask) >>> 0
  };

  return detail === 0 ? decoded : { ...decoded, detail };
}

function assertExitReason(value: number): asserts value is ExitReason {
  if (!Number.isInteger(value) || !exitReasons.has(value)) {
    throw new RangeError(`unknown Wasm exit reason: ${value}`);
  }
}

function assertExitDetail(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > Number(detailMask)) {
    throw new RangeError(`Wasm exit detail out of range: ${value}`);
  }
}
