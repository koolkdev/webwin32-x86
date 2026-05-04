import { reg32, type Reg32 } from "#x86/isa/types.js";
import { IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import type { StorageRef } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import type {
  JitExitSnapshotKind,
  JitStateSnapshot
} from "#backends/wasm/jit/codegen/plan/types.js";

export class JitBlockStateTracker {
  private readonly committedRegs = new Set<Reg32>();
  private readonly speculativeRegs = new Set<Reg32>();
  private committedFlagsMask = IR_ALU_FLAG_MASK;
  private speculativeFlagsMask = 0;
  private instructionCountDelta = 0;

  snapshot(kind: JitExitSnapshotKind, eip: number): JitStateSnapshot {
    return {
      kind,
      eip,
      instructionCountDelta: this.instructionCountDelta,
      committedRegs: sortedRegs(this.committedRegs),
      speculativeRegs: sortedRegs(this.speculativeRegs),
      committedFlags: { mask: this.committedFlagsMask },
      speculativeFlags: { mask: this.speculativeFlagsMask }
    };
  }

  snapshotPostInstruction(eip: number): JitStateSnapshot {
    const committedRegs = sortedRegs(new Set([...this.committedRegs, ...this.speculativeRegs]));

    return {
      kind: "postInstruction",
      eip,
      instructionCountDelta: this.instructionCountDelta + 1,
      committedRegs,
      speculativeRegs: [],
      committedFlags: { mask: this.committedFlagsMask },
      speculativeFlags: { mask: this.speculativeFlagsMask }
    };
  }

  pendingFlags(mask: number): number {
    return mask & this.speculativeFlagsMask;
  }

  recordStorageWrite(storage: StorageRef, operands: readonly JitOperandBinding[]): void {
    switch (storage.kind) {
      case "reg":
        this.speculativeRegs.add(storage.reg);
        return;
      case "operand": {
        const binding = operands[storage.index]!;

        if (binding.kind === "static.reg32") {
          this.speculativeRegs.add(binding.reg);
        }
        return;
      }
      case "mem":
        return;
    }
  }

  recordCommittedStorageWrite(storage: StorageRef, operands: readonly JitOperandBinding[]): void {
    switch (storage.kind) {
      case "reg":
        this.committedRegs.add(storage.reg);
        return;
      case "operand": {
        const binding = operands[storage.index]!;

        if (binding.kind === "static.reg32") {
          this.committedRegs.add(binding.reg);
        }
        return;
      }
      case "mem":
        return;
    }
  }

  markSpeculativeFlags(mask: number): void {
    this.speculativeFlagsMask |= mask;
    this.committedFlagsMask &= ~mask;
  }

  commitFlags(mask: number): void {
    const committedMask = mask & this.speculativeFlagsMask;

    this.speculativeFlagsMask &= ~mask;
    this.committedFlagsMask |= committedMask;
  }

  commitInstruction(): void {
    for (const reg of this.speculativeRegs) {
      this.committedRegs.add(reg);
    }

    this.speculativeRegs.clear();
    this.instructionCountDelta += 1;
  }
}

function sortedRegs(regs: ReadonlySet<Reg32>): readonly Reg32[] {
  return reg32.filter((reg) => regs.has(reg));
}
