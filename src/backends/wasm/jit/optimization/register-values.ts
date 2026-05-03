import type { Reg32 } from "#x86/isa/types.js";
import type { JitValue } from "./values.js";

export class JitRegisterValues {
  readonly values = new Map<Reg32, JitValue>();
  private readonly readCounts = new Map<Reg32, number>();

  get size(): number {
    return this.values.size;
  }

  entries(): IterableIterator<[Reg32, JitValue]> {
    return this.values.entries();
  }

  get(reg: Reg32): JitValue | undefined {
    return this.values.get(reg);
  }

  has(reg: Reg32): boolean {
    return this.values.has(reg);
  }

  set(reg: Reg32, value: JitValue): void {
    this.values.set(reg, value);
    this.readCounts.set(reg, 0);
  }

  delete(reg: Reg32): void {
    this.values.delete(reg);
    this.readCounts.delete(reg);
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
}
