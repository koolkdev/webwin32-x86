import type { Reg32 } from "#x86/isa/types.js";
import type { ValueRef, VarRef } from "#x86/ir/model/types.js";
import { jitIrOpDst } from "#backends/wasm/jit/ir-semantics.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitVirtualValue } from "./virtual-values.js";

export type JitInstructionRewrite = {
  ops: JitIrOp[];
  localValues: Map<number, JitVirtualValue>;
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

export function createJitInstructionRewrite(instruction: JitIrBlockInstruction): JitInstructionRewrite {
  return {
    ops: [],
    localValues: new Map(),
    nextVarId: nextInstructionVarId(instruction)
  };
}

export function createJitPreludeRewrite(): JitInstructionRewrite {
  return {
    ops: [],
    localValues: new Map(),
    nextVarId: 0
  };
}

export function materializeJitVirtualReg(
  rewrite: JitInstructionRewrite,
  reg: Reg32,
  value: JitVirtualValue
): void {
  rewrite.ops.push({
    op: "set32",
    target: { kind: "reg", reg },
    value: emitJitValueRef(rewrite, value)
  });
}

export function emitJitValueRef(rewrite: JitInstructionRewrite, value: JitVirtualValue): ValueRef {
  const existingValue = existingJitValueRef(rewrite, value);

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
        a: emitJitValueRef(rewrite, value.a),
        b: emitJitValueRef(rewrite, value.b)
      });
      rewrite.localValues.set(dst.id, value);
      return dst;
    }
  }
}

export function assignJitValue(
  rewrite: JitInstructionRewrite,
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
        a: emitJitValueRef(rewrite, value.a),
        b: emitJitValueRef(rewrite, value.b)
      });
      return;
  }
}

function existingJitValueRef(
  rewrite: JitInstructionRewrite,
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
