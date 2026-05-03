import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import { JitFlagOwners } from "./flag-owners.js";
import { JitRegisterValues } from "./register-values.js";
import {
  createJitInstructionRewrite,
  type JitInstructionRewrite
} from "./rewrite.js";
import { JitValueTracker } from "./value-tracker.js";
import type { JitOptimizationContext } from "./context.js";

export class JitOptimizationState {
  readonly values = new JitValueTracker();
  readonly registers = new JitRegisterValues();
  readonly flags = JitFlagOwners.incoming();

  constructor(readonly context: JitOptimizationContext) {}

  beginInstructionValues(): JitValueTracker {
    this.values.clear();
    return this.values;
  }

  beginInstructionRewrite(instruction: JitIrBlockInstruction): JitInstructionRewrite {
    this.beginInstructionValues();
    return createJitInstructionRewrite(instruction, this.values);
  }

  recordOpValue(
    op: JitIrOp,
    instruction: JitIrBlockInstruction
  ): boolean {
    return this.values.recordOp(op, instruction, this.registers.trackedValues);
  }
}
