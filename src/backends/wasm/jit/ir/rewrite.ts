import type { Reg32 } from "#x86/isa/types.js";
import type { ValueRef, VarRef } from "#x86/ir/model/types.js";
import { jitIrOpDst } from "#backends/wasm/jit/ir/semantics.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/ir/types.js";
import type { JitBinaryValue, JitUnaryValue, JitValue } from "#backends/wasm/jit/ir/values.js";
import { jitValueIsBinary, jitValueIsSymbolicReg, jitValueIsUnary } from "#backends/wasm/jit/ir/values.js";
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
): boolean {
  return materializeJitRegisterValues(rewrite, [{ reg, value }]) !== 0;
}

export function materializeJitRegisterValues(
  rewrite: JitInstructionRewrite,
  values: readonly Readonly<{ reg: Reg32; value: JitValue }>[]
): number {
  const refs = values.flatMap(({ reg, value }) =>
    jitValueIsSymbolicReg(value, reg)
      ? []
      : [{ reg, value: emitJitValueRef(rewrite, value) }]
  );

  for (const { reg, value } of refs) {
    rewrite.ops.push({
      op: "set",
      role: "registerMaterialization",
      target: { kind: "reg", reg },
      value
    });
  }

  return refs.length;
}

function emitJitValueGet(
  rewrite: JitInstructionRewrite,
  value: Extract<JitValue, { kind: "reg" }>
): ValueRef {
  const dst = allocVar(rewrite);

  rewrite.ops.push({
    op: "get",
    dst,
    source: { kind: "reg", reg: value.reg },
    role: "symbolicRead"
  });
  rewrite.values.record(dst.id, value);
  return dst;
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

  if (jitValueIsUnary(value)) {
    const dst = allocVar(rewrite);

    emitJitUnaryValueOp(rewrite, dst, value);
    rewrite.values.record(dst.id, value);
    return dst;
  }

  switch (value.kind) {
    case "const32":
      return { kind: "const32", value: value.value };
    case "reg":
      return emitJitValueGet(rewrite, value);
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

  if (jitValueIsUnary(value)) {
    emitJitUnaryValueOp(rewrite, dst, value);
    return;
  }

  switch (value.kind) {
    case "const32":
      rewrite.ops.push({ op: "const32", dst, value: value.value });
      return;
    case "reg":
      rewrite.ops.push({
        op: "get",
        dst,
        source: { kind: "reg", reg: value.reg },
        role: "symbolicRead"
      });
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

function emitJitUnaryValueOp(
  rewrite: JitInstructionRewrite,
  dst: VarRef,
  value: JitUnaryValue
): void {
  rewrite.ops.push({
    op: value.kind,
    dst,
    value: emitJitValueRef(rewrite, value.value)
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
