import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "./analysis.js";
import { jitPreInstructionExitReasonAt } from "./boundaries.js";
import type { JitVirtualRewrite } from "./virtual-rewrite.js";
import {
  jitVirtualValueForEffectiveAddress,
  jitVirtualValueForStorage,
  jitVirtualValueForValue
} from "./virtual-values.js";

export function firstVirtualRegisterFoldableOpIndex(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  analysis: JitOptimizationAnalysis
): number {
  let firstFoldableOpIndex = 0;

  for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
    if (jitPreInstructionExitReasonAt(analysis.boundaries, instructionIndex, opIndex) !== undefined) {
      firstFoldableOpIndex = opIndex + 1;
    }
  }

  return firstFoldableOpIndex;
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
