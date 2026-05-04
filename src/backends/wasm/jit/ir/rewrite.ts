import type { Reg32 } from "#x86/isa/types.js";
import type { ValueRef, VarRef } from "#x86/ir/model/types.js";
import { jitIrOpDst } from "#backends/wasm/jit/ir/semantics.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/ir/types.js";
import type { JitBinaryValue, JitValue } from "#backends/wasm/jit/ir/values.js";
import { jitValueIsBinary } from "#backends/wasm/jit/ir/values.js";
import { JitValueTracker } from "#backends/wasm/jit/ir/value-tracker.js";

export type JitInstructionRewrite = {
  ops: JitIrOp[];
  values: JitValueTracker;
  nextVarId: number;
};

export type JitInstructionRewriteOp = Readonly<{
  instruction: JitIrBlockInstruction;
  instructionIndex: number;
  op: JitIrOp;
  opIndex: number;
  rewrite: JitInstructionRewrite;
}>;

export function rewriteJitIrInstruction(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  context: string,
  rewriteOp: (entry: JitInstructionRewriteOp) => void
): JitIrBlockInstruction {
  const rewrite = createJitInstructionRewrite(instruction);

  rewriteJitIrInstructionInto(instruction, instructionIndex, context, rewrite, rewriteOp);
  return {
    ...instruction,
    ir: rewrite.ops
  };
}

export function rewriteJitIrInstructionInto(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  context: string,
  rewrite: JitInstructionRewrite,
  rewriteOp: (entry: JitInstructionRewriteOp) => void
): void {
  for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
    const op = instruction.ir[opIndex];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while ${context}: ${instructionIndex}:${opIndex}`);
    }

    rewriteOp({ instruction, instructionIndex, op, opIndex, rewrite });
  }
}

export function createJitInstructionRewrite(
  instruction: JitIrBlockInstruction,
  values: JitValueTracker = new JitValueTracker()
): JitInstructionRewrite {
  return {
    ops: [],
    values,
    nextVarId: nextInstructionVarId(instruction)
  };
}

export function materializeJitRegisterValue(
  rewrite: JitInstructionRewrite,
  reg: Reg32,
  value: JitValue
): void {
  rewrite.ops.push({
    op: "set32",
    role: "registerMaterialization",
    target: { kind: "reg", reg },
    value: emitJitValueRef(rewrite, value)
  });
}

export function emitJitValueRef(rewrite: JitInstructionRewrite, value: JitValue): ValueRef {
  const existingValue = rewrite.values.refFor(value);

  if (existingValue !== undefined) {
    return existingValue;
  }

  if (jitValueIsBinary(value)) {
    const dst = allocVar(rewrite);

    emitJitBinaryValueOp(rewrite, dst, value);
    rewrite.values.record(dst.id, value);
    return dst;
  }

  switch (value.kind) {
    case "const32":
      return { kind: "const32", value: value.value };
    case "reg": {
      const dst = allocVar(rewrite);

      rewrite.ops.push({ op: "get32", dst, source: { kind: "reg", reg: value.reg } });
      rewrite.values.record(dst.id, value);
      return dst;
    }
  }
}

export function assignJitValue(
  rewrite: JitInstructionRewrite,
  dst: VarRef,
  value: JitValue
): void {
  if (jitValueIsBinary(value)) {
    emitJitBinaryValueOp(rewrite, dst, value);
    return;
  }

  switch (value.kind) {
    case "const32":
      rewrite.ops.push({ op: "const32", dst, value: value.value });
      return;
    case "reg":
      rewrite.ops.push({ op: "get32", dst, source: { kind: "reg", reg: value.reg } });
      return;
  }
}

function emitJitBinaryValueOp(
  rewrite: JitInstructionRewrite,
  dst: VarRef,
  value: JitBinaryValue
): void {
  rewrite.ops.push({
    op: value.kind,
    dst,
    a: emitJitValueRef(rewrite, value.a),
    b: emitJitValueRef(rewrite, value.b)
  });
}

function allocVar(rewrite: JitInstructionRewrite): VarRef {
  const varRef = { kind: "var" as const, id: rewrite.nextVarId };

  rewrite.nextVarId += 1;
  return varRef;
}

function nextInstructionVarId(instruction: JitIrBlockInstruction): number {
  let nextVarId = 0;

  for (const op of instruction.ir) {
    const dst = jitIrOpDst(op);

    if (dst !== undefined) {
      nextVarId = Math.max(nextVarId, dst.id + 1);
    }
  }

  return nextVarId;
}
