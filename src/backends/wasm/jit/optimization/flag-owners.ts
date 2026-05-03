import { type Reg32 } from "#x86/isa/types.js";
import {
  IR_ALU_FLAG_MASK,
  IR_ALU_FLAG_MASKS
} from "#x86/ir/model/flag-effects.js";
import type { JitFlagSource } from "./flag-sources.js";

export type JitVirtualFlagOwner =
  | Readonly<{ kind: "incoming" }>
  | Readonly<{ kind: "materialized" }>
  | Readonly<{ kind: "producer"; source: JitFlagSource }>;

export type JitVirtualFlagOwnerMask = Readonly<{
  mask: number;
  owner: JitVirtualFlagOwner;
}>;

const incomingJitFlagOwner: JitVirtualFlagOwner = { kind: "incoming" };
const materializedJitFlagOwner: JitVirtualFlagOwner = { kind: "materialized" };

const flagBits = Object.values(IR_ALU_FLAG_MASKS);

export class JitFlagOwners {
  static incoming(): JitFlagOwners {
    return new JitFlagOwners(
      new Map(flagBits.map((flagBit) => [flagBit, incomingJitFlagOwner]))
    );
  }

  private constructor(private readonly byFlag: Map<number, JitVirtualFlagOwner>) {}

  clone(): JitFlagOwners {
    return new JitFlagOwners(new Map(this.byFlag));
  }

  recordMaterialized(mask: number): void {
    this.set(mask, materializedJitFlagOwner);
  }

  recordSource(source: JitFlagSource): void {
    this.set(source.writtenMask | source.undefMask, { kind: "producer", source });
  }

  forMask(mask: number): readonly JitVirtualFlagOwnerMask[] {
    const owners: JitVirtualFlagOwnerMask[] = [];

    for (const flagBit of flagBits) {
      if ((mask & flagBit) === 0) {
        continue;
      }

      const owner = this.byFlag.get(flagBit) ?? incomingJitFlagOwner;
      const existingIndex = owners.findIndex((entry) => sameOwner(entry.owner, owner));

      if (existingIndex === -1) {
        owners.push({ mask: flagBit, owner });
      } else {
        const existing = owners[existingIndex]!;

        owners[existingIndex] = {
          mask: existing.mask | flagBit,
          owner: existing.owner
        };
      }
    }

    return owners;
  }

  producerOwnersReadingReg(reg: Reg32): readonly JitVirtualFlagOwnerMask[] {
    return this.forMask(IR_ALU_FLAG_MASK).filter((entry) =>
      entry.owner.kind === "producer" && entry.owner.source.readRegs.includes(reg)
    );
  }

  private set(mask: number, owner: JitVirtualFlagOwner): void {
    for (const flagBit of flagBits) {
      if ((mask & flagBit) !== 0) {
        this.byFlag.set(flagBit, owner);
      }
    }
  }
}

function sameOwner(a: JitVirtualFlagOwner, b: JitVirtualFlagOwner): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind === "producer" && b.kind === "producer") {
    return a.source === b.source;
  }

  return true;
}
