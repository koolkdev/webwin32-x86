import type { IrOp } from "#x86/ir/model/types.js";
import type { JitOptimizedIrPreludeOp } from "./types.js";

export function toJitOptimizedIrPreludeOp(op: IrOp): JitOptimizedIrPreludeOp {
  if (isJitOptimizedIrPreludeOp(op)) {
    return op;
  }

  throw new Error(`JIT prelude op must be register materialization, got ${op.op}`);
}

export function assertJitOptimizedIrPreludeOp(op: IrOp): asserts op is JitOptimizedIrPreludeOp {
  void toJitOptimizedIrPreludeOp(op);
}

function isJitOptimizedIrPreludeOp(op: IrOp): op is JitOptimizedIrPreludeOp {
  switch (op.op) {
    case "get32":
      return op.source.kind === "reg";
    case "set32":
      return op.target.kind === "reg";
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      return true;
    default:
      return false;
  }
}
