import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import { JitFlagOwners } from "./flag-owners.js";
import { JitRegisterValues } from "./register-values.js";
import {
  createJitInstructionRewrite,
  type JitInstructionRewrite
} from "./rewrite.js";
import { JitValueTracker } from "./value-tracker.js";

export class JitOptimizationState {
  readonly values = new JitValueTracker();
  readonly registers = new JitRegisterValues();
  readonly flags = JitFlagOwners.incoming();

  beginInstructionRewrite(instruction: JitIrBlockInstruction): JitInstructionRewrite {
    this.values.clear();
    return createJitInstructionRewrite(instruction, this.values);
  }

  recordOpValue(
    op: JitIrOp,
    instruction: JitIrBlockInstruction
  ): boolean {
    return this.values.recordOp(op, instruction, this.registers.trackedValues);
  }
}
