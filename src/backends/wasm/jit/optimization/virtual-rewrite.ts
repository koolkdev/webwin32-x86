import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp, ValueRef, VarRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitVirtualValue } from "./virtual-values.js";

export type JitVirtualRewrite = {
  ops: IrOp[];
  localValues: Map<number, JitVirtualValue>;
  nextVarId: number;
};

export function createJitVirtualRewrite(instruction: JitIrBlockInstruction): JitVirtualRewrite {
  return {
    ops: [],
    localValues: new Map(),
    nextVarId: nextInstructionVarId(instruction)
  };
}

export function materializeJitVirtualReg(
  rewrite: JitVirtualRewrite,
  reg: Reg32,
  value: JitVirtualValue
): void {
  rewrite.ops.push({
    op: "set32",
    target: { kind: "reg", reg },
    value: emitJitVirtualValue(rewrite, value)
  });
}

export function emitJitVirtualValue(rewrite: JitVirtualRewrite, value: JitVirtualValue): ValueRef {
  const existingValue = existingJitVirtualValueRef(rewrite, value);

  if (existingValue !== undefined) {
    return existingValue;
  }

  switch (value.kind) {
    case "const32":
      return { kind: "const32", value: value.value };
    case "reg": {
      const dst = allocVar(rewrite);

      rewrite.ops.push({ op: "get32", dst, source: { kind: "reg", reg: value.reg } });
      rewrite.localValues.set(dst.id, value);
      return dst;
    }
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and": {
      const dst = allocVar(rewrite);

      rewrite.ops.push({
        op: value.kind,
        dst,
        a: emitJitVirtualValue(rewrite, value.a),
        b: emitJitVirtualValue(rewrite, value.b)
      });
      rewrite.localValues.set(dst.id, value);
      return dst;
    }
  }
}

export function emitJitVirtualValueToVar(
  rewrite: JitVirtualRewrite,
  dst: VarRef,
  value: JitVirtualValue
): void {
  switch (value.kind) {
    case "const32":
      rewrite.ops.push({ op: "const32", dst, value: value.value });
      return;
    case "reg":
      rewrite.ops.push({ op: "get32", dst, source: { kind: "reg", reg: value.reg } });
      return;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      rewrite.ops.push({
        op: value.kind,
        dst,
        a: emitJitVirtualValue(rewrite, value.a),
        b: emitJitVirtualValue(rewrite, value.b)
      });
      return;
  }
}

function existingJitVirtualValueRef(
  rewrite: JitVirtualRewrite,
  value: JitVirtualValue
): ValueRef | undefined {
  if (value.kind === "const32") {
    return { kind: "const32", value: value.value };
  }

  for (const [id, localValue] of rewrite.localValues) {
    if (localValue === value) {
      return { kind: "var", id };
    }
  }

  return undefined;
}

function allocVar(rewrite: JitVirtualRewrite): VarRef {
  const varRef = { kind: "var" as const, id: rewrite.nextVarId };

  rewrite.nextVarId += 1;
  return varRef;
}

function nextInstructionVarId(instruction: JitIrBlockInstruction): number {
  let nextVarId = 0;

  for (const op of instruction.ir) {
    const dst = opDst(op);

    if (dst !== undefined) {
      nextVarId = Math.max(nextVarId, dst.id + 1);
    }
  }

  return nextVarId;
}

function opDst(op: IrOp): VarRef | undefined {
  switch (op.op) {
    case "get32":
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "aluFlags.condition":
    case "flagProducer.condition":
      return op.dst;
    default:
      return undefined;
  }
}
