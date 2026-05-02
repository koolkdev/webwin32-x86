import { u32 } from "../../x86/state/cpu-state.js";

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
}>;

const payloadMask = 0xffff_ffffn;
const exitReasonMask = 0xffffn;
const exitReasonShift = 32n;
const exitReasons = new Set<number>(Object.values(ExitReason));

export function encodeExit(exitReason: ExitReason, payload: number): bigint {
  assertExitReason(exitReason);

  return (BigInt(exitReason) << exitReasonShift) | BigInt(u32(payload));
}

export function decodeExit(value: bigint): DecodedExit {
  const exitReason = Number((value >> exitReasonShift) & exitReasonMask);

  assertExitReason(exitReason);

  return {
    exitReason,
    payload: Number(value & payloadMask) >>> 0
  };
}

function assertExitReason(value: number): asserts value is ExitReason {
  if (!Number.isInteger(value) || !exitReasons.has(value)) {
    throw new RangeError(`unknown Wasm exit reason: ${value}`);
  }
}
