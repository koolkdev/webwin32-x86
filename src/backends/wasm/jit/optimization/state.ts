import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  createJitInstructionRewrite,
  type JitInstructionRewrite
} from "./rewrite.js";
import { JitTrackedState } from "./tracked-state.js";
import { JitValueTracker } from "./value-tracker.js";
import type { JitOptimizationContext } from "./context.js";

export class JitOptimizationState {
  readonly values = new JitValueTracker();
  readonly tracked: JitTrackedState;

  constructor(readonly context: JitOptimizationContext) {
    this.tracked = new JitTrackedState(context);
  }

  get registers() {
    return this.tracked.registers;
  }

  get flags() {
    return this.tracked.flags;
  }

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
    return this.values.recordOp(op, instruction, this.tracked.registers.trackedValues);
  }
}
