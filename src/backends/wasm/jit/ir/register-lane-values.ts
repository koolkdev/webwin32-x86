import { widthMask, type OperandWidth, type RegisterAlias, type Reg32 } from "#x86/isa/types.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import type { JitValue } from "#backends/wasm/jit/ir/values.js";

export type JitRegisterAccess = Readonly<{
  reg: Reg32;
  width: OperandWidth;
  bitOffset: RegisterAlias["bitOffset"];
}>;

export type JitRegisterAccessState = {
  full?: JitValue;
  bytes: (JitValue | undefined)[];
  lanes: Map<string, JitValue>;
};

export type JitRegisterValueEntry = JitValue | JitRegisterAccessState;
export type JitRegisterValueMap = ReadonlyMap<Reg32, JitRegisterValueEntry>;

const byteWidth = 8;
const fullWidth = 32;
const fullByteCount = fullWidth / byteWidth;

export function createRegisterAccessState(): JitRegisterAccessState {
  return {
    bytes: Array.from({ length: fullByteCount }, () => undefined),
    lanes: new Map()
  };
}

export function readRegisterAccess(
  regState: JitRegisterAccessState | undefined,
  width: OperandWidth,
  bitOffset: RegisterAlias["bitOffset"]
): JitValue | undefined {
  if (regState === undefined) {
    return undefined;
  }

  if (width === fullWidth) {
    return bitOffset === 0 ? regState.full : undefined;
  }

  const exactLane = regState.lanes.get(registerAccessKey(width, bitOffset));

  if (exactLane !== undefined) {
    return exactLane;
  }

  if (regState.full !== undefined) {
    return extractJitRegisterAccessValue(regState.full, width, bitOffset);
  }

  if (width === byteWidth) {
    return regState.bytes[bitOffset / byteWidth];
  }

  return undefined;
}

export function writeRegisterAccess(
  regState: JitRegisterAccessState,
  width: OperandWidth,
  bitOffset: RegisterAlias["bitOffset"],
  value: JitValue
): void {
  if (width === fullWidth) {
    regState.full = value;
    clearByteValues(regState);
    regState.lanes.clear();
    return;
  }

  delete regState.full;
  clearOverlappingLanes(regState, width, bitOffset);
  regState.lanes.set(registerAccessKey(width, bitOffset), value);

  const startByte = bitOffset / byteWidth;
  const byteLength = width / byteWidth;

  for (let index = 0; index < byteLength; index += 1) {
    const byteBitOffset = index === 0 ? 0 : 8;

    regState.bytes[startByte + index] = extractJitRegisterAccessValue(value, byteWidth, byteBitOffset);
  }
}

export function extractJitRegisterAccessValue(
  value: JitValue,
  width: OperandWidth,
  bitOffset: RegisterAlias["bitOffset"]
): JitValue {
  if (width === fullWidth && bitOffset === 0) {
    return value;
  }

  if (value.kind === "const32") {
    return {
      kind: "const32",
      value: i32(width === fullWidth
        ? value.value >>> bitOffset
        : (value.value >>> bitOffset) & widthMask(width))
    };
  }

  const shifted = bitOffset === 0
    ? value
    : {
      kind: "value.binary" as const,
      type: "i32" as const,
      operator: "shr_u" as const,
      a: value,
      b: { kind: "const32" as const, value: bitOffset }
    };

  return width === fullWidth
    ? shifted
    : {
      kind: "value.binary",
      type: "i32",
      operator: "and",
      a: shifted,
      b: { kind: "const32", value: widthMask(width) }
    };
}

export function jitStorageRegisterAccess(
  storage: StorageRef,
  operands: readonly JitOperandBinding[],
  accessWidth: OperandWidth = fullWidth
): JitRegisterAccess | undefined {
  switch (storage.kind) {
    case "reg":
      return { reg: storage.reg, width: accessWidth, bitOffset: 0 };
    case "operand": {
      const binding = operands[storage.index]!;

      return binding.kind === "static.reg"
        ? {
          reg: binding.alias.base,
          width: binding.alias.width,
          bitOffset: binding.alias.bitOffset
        }
        : undefined;
    }
    case "mem":
      return undefined;
  }
}

export function readRegisterValueEntry(
  entry: JitRegisterValueEntry | undefined,
  width: OperandWidth,
  bitOffset: RegisterAlias["bitOffset"]
): JitValue | undefined {
  if (entry === undefined) {
    return undefined;
  }

  if (jitRegisterValueEntryIsState(entry)) {
    return readRegisterAccess(entry, width, bitOffset);
  }

  return width === fullWidth && bitOffset === 0
    ? entry
    : extractJitRegisterAccessValue(entry, width, bitOffset);
}

export function fullRegisterValueForEntry(entry: JitRegisterValueEntry | undefined): JitValue | undefined {
  if (entry === undefined) {
    return undefined;
  }

  return jitRegisterValueEntryIsState(entry) ? entry.full : entry;
}

export function registerValueEntryHasFullValue(entry: JitRegisterValueEntry | undefined): boolean {
  return fullRegisterValueForEntry(entry) !== undefined;
}

function jitRegisterValueEntryIsState(entry: JitRegisterValueEntry): entry is JitRegisterAccessState {
  return !("kind" in entry);
}

function registerAccessKey(width: OperandWidth, bitOffset: RegisterAlias["bitOffset"]): string {
  return `${bitOffset}:${width}`;
}

function clearByteValues(regState: JitRegisterAccessState): void {
  for (let index = 0; index < fullByteCount; index += 1) {
    regState.bytes[index] = undefined;
  }
}

function clearOverlappingLanes(
  regState: JitRegisterAccessState,
  width: OperandWidth,
  bitOffset: RegisterAlias["bitOffset"]
): void {
  for (const key of regState.lanes.keys()) {
    const lane = registerAccessFromKey(key);

    if (registerAccessesOverlap(width, bitOffset, lane.width, lane.bitOffset)) {
      regState.lanes.delete(key);
    }
  }
}

function registerAccessFromKey(key: string): Readonly<{
  width: OperandWidth;
  bitOffset: RegisterAlias["bitOffset"];
}> {
  const [bitOffset, width] = key.split(":").map(Number);

  if ((width !== 8 && width !== 16 && width !== 32) || (bitOffset !== 0 && bitOffset !== 8)) {
    throw new Error(`invalid register access key: ${key}`);
  }

  return { width, bitOffset };
}

function registerAccessesOverlap(
  width: OperandWidth,
  bitOffset: RegisterAlias["bitOffset"],
  otherWidth: OperandWidth,
  otherBitOffset: RegisterAlias["bitOffset"]
): boolean {
  const end = bitOffset + width;
  const otherEnd = otherBitOffset + otherWidth;

  return bitOffset < otherEnd && otherBitOffset < end;
}
