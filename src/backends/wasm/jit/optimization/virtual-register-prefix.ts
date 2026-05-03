import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "./analysis.js";
import { jitFirstOpIndexAfterPreInstructionExits } from "./boundaries.js";
import type { JitVirtualRewrite } from "./virtual-rewrite.js";
import {
  jitVirtualValueForEffectiveAddress,
  jitVirtualValueForStorage,
  jitVirtualValueForValue
} from "./virtual-values.js";

export function firstVirtualRegisterFoldableOpIndex(
  instructionIndex: number,
  analysis: JitOptimizationAnalysis
): number {
  return jitFirstOpIndexAfterPreInstructionExits(analysis.boundaries, instructionIndex);
}

export function recordCopiedVirtualRegisterOp(
  op: IrOp,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite
): void {
  switch (op.op) {
    case "get32": {
      const value = jitVirtualValueForStorage(op.source, instruction.operands);

      if (value !== undefined) {
        rewrite.localValues.set(op.dst.id, value);
      }
      return;
    }
    case "address32": {
      const value = jitVirtualValueForEffectiveAddress(op.operand, instruction.operands, new Map());

      if (value !== undefined) {
        rewrite.localValues.set(op.dst.id, value);
      }
      return;
    }
    case "const32":
      rewrite.localValues.set(op.dst.id, { kind: "const32", value: op.value });
      return;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and": {
      const a = jitVirtualValueForValue(op.a, rewrite.localValues);
      const b = jitVirtualValueForValue(op.b, rewrite.localValues);

      if (a !== undefined && b !== undefined) {
        rewrite.localValues.set(op.dst.id, { kind: op.op, a, b });
      }
      return;
    }
    default:
      return;
  }
}
