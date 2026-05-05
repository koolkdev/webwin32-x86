import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import type { OperandRef, StorageRef } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import type { JitValue } from "#backends/wasm/jit/ir/values.js";
import {
  jitStorageHasRegisterValue,
  jitRegisterValuesReadByEffectiveAddress,
  jitValueReadsReg,
  jitValueForEffectiveAddress,
  jitValueForStorage
} from "#backends/wasm/jit/ir/values.js";
import {
  createRegisterAccessState,
  writeRegisterAccess,
  type JitRegisterAccessState
} from "#backends/wasm/jit/ir/register-lane-values.js";

export class JitRegisterValues {
  private readonly values = new Map<Reg32, JitRegisterAccessState>();
  private readonly readCounts = new Map<Reg32, number>();

  get trackedValues(): ReadonlyMap<Reg32, JitValue> {
    return new Map(this.fullValueEntries());
  }

  get trackedRegisterValues(): ReadonlyMap<Reg32, JitRegisterAccessState> {
    return this.values;
  }

  get size(): number {
    return this.values.size;
  }

  entries(): IterableIterator<[Reg32, JitValue]> {
    return this.trackedValues.entries();
  }

  get(reg: Reg32): JitValue | undefined {
    return this.values.get(reg)?.full;
  }

  has(reg: Reg32): boolean {
    return this.values.has(reg);
  }

  hasStorageValue(
    storage: StorageRef,
    operands: readonly JitOperandBinding[],
    accessWidth: OperandWidth = 32
  ): boolean {
    return jitStorageHasRegisterValue(storage, operands, this.values, accessWidth);
  }

  valueForEffectiveAddress(
    operand: OperandRef,
    operands: readonly JitOperandBinding[]
  ): JitValue | undefined {
    return jitValueForEffectiveAddress(operand, operands, this.values);
  }

  valueForStorage(
    storage: StorageRef,
    operands: readonly JitOperandBinding[],
    accessWidth: OperandWidth = 32,
    signed = false
  ): JitValue | undefined {
    return jitValueForStorage(storage, operands, this.values, accessWidth, signed);
  }

  regsReadByEffectiveAddress(
    operand: OperandRef,
    operands: readonly JitOperandBinding[]
  ): readonly Reg32[] {
    return jitRegisterValuesReadByEffectiveAddress(operand, operands, this.values);
  }

  set(reg: Reg32, value: JitValue): void {
    writeRegisterAccess(this.writableState(reg), 32, 0, value);
    this.readCounts.set(reg, 0);
  }

  write(
    reg: Reg32,
    width: OperandWidth,
    bitOffset: RegisterAlias["bitOffset"],
    value: JitValue
  ): void {
    writeRegisterAccess(this.writableState(reg), width, bitOffset, value);
    this.readCounts.set(reg, 0);
  }

  delete(reg: Reg32): void {
    this.values.delete(reg);
    this.readCounts.delete(reg);
  }

  deletePartialDependencies(clobberedReg: Reg32): void {
    for (const [reg, state] of this.values) {
      if (state.full !== undefined) {
        continue;
      }

      const values = [
        ...state.bytes.flatMap((value) => value === undefined ? [] : [value]),
        ...state.lanes.values()
      ];

      if (values.some((value) => jitValueReadsReg(value, clobberedReg))) {
        this.delete(reg);
      }
    }
  }

  clear(): void {
    this.values.clear();
    this.readCounts.clear();
  }

  readCount(reg: Reg32): number {
    return this.readCounts.get(reg) ?? 0;
  }

  recordRead(reg: Reg32): void {
    this.readCounts.set(reg, this.readCount(reg) + 1);
  }

  clearReadCounts(): void {
    this.readCounts.clear();
  }

  resetReadCount(reg: Reg32): void {
    this.readCounts.delete(reg);
  }

  syncReadCounts(): void {
    for (const reg of this.readCounts.keys()) {
      if (!this.values.has(reg)) {
        this.readCounts.delete(reg);
      }
    }
  }

  private writableState(reg: Reg32): JitRegisterAccessState {
    const existing = this.values.get(reg);

    if (existing !== undefined) {
      return existing;
    }

    const state = createRegisterAccessState();

    this.values.set(reg, state);
    return state;
  }

  private fullValueEntries(): readonly [Reg32, JitValue][] {
    return [...this.values].flatMap(([reg, state]) =>
      state.full === undefined ? [] : [[reg, state.full]]
    );
  }
}
