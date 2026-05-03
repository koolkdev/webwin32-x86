import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  flushVirtualRegs,
  flushVirtualRegsDependingOn,
  flushVirtualRegsIntoPreviousInstruction,
  instructionMayFault,
  nextInstructionMayFault
} from "./virtual-boundaries.js";
import {
  createJitVirtualRewrite,
  emitJitVirtualValueToVar,
  type JitVirtualRewrite
} from "./virtual-rewrite.js";
import {
  jitStorageHasVirtualRegister,
  jitStorageReg,
  jitVirtualValueForStorage,
  jitVirtualValueForValue,
  type JitVirtualValue
} from "./virtual-values.js";

export type JitVirtualRegisterFolding = Readonly<{
  removedSetCount: number;
  flushSetCount: number;
}>;

type RewriteResult = Readonly<{
  removedSet: boolean;
  flushSetCount: number;
}>;

const unchangedOpResult: RewriteResult = { removedSet: false, flushSetCount: 0 };

export function foldJitVirtualRegisters(
  block: JitIrBlock
): Readonly<{ block: JitIrBlock; folding: JitVirtualRegisterFolding }> {
  const virtualRegs = new Map<Reg32, JitVirtualValue>();
  const instructions: JitIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let flushSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while folding virtual registers: ${instructionIndex}`);
    }

    if (instructionMayFault(instruction)) {
      flushSetCount += flushVirtualRegsIntoPreviousInstruction(instructions, virtualRegs);
      virtualRegs.clear();
      instructions.push(instruction);
      continue;
    }

    const rewrite = createJitVirtualRewrite(instruction);
    const nextInstruction = block.instructions[instructionIndex + 1];

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while folding virtual registers: ${instructionIndex}:${opIndex}`);
      }

      const result = rewriteOp(op, instruction, nextInstruction, rewrite, virtualRegs);

      if (result.removedSet) {
        removedSetCount += 1;
      }

      flushSetCount += result.flushSetCount;
    }

    instructions.push({
      ...instruction,
      ir: rewrite.ops
    });
  }

  if (virtualRegs.size !== 0) {
    throw new Error("JIT virtual registers were not flushed before block end");
  }

  return {
    block: { instructions },
    folding: { removedSetCount, flushSetCount }
  };
}

function rewriteOp(
  op: IrOp,
  instruction: JitIrBlockInstruction,
  nextInstruction: JitIrBlockInstruction | undefined,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>
): RewriteResult {
  switch (op.op) {
    case "get32":
      rewriteGet32(op, instruction, rewrite, virtualRegs);
      return unchangedOpResult;
    case "const32":
      rewrite.localValues.set(op.dst.id, { kind: "const32", value: op.value });
      rewrite.ops.push(op);
      return unchangedOpResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      recordBinaryValue(op, rewrite);
      rewrite.ops.push(op);
      return unchangedOpResult;
    case "set32":
      return rewriteSet32(op, instruction, rewrite, virtualRegs);
    case "next": {
      const flushSetCount = instruction.nextMode === "exit" || nextInstructionMayFault(nextInstruction)
        ? flushVirtualRegs(rewrite, virtualRegs)
        : 0;

      rewrite.ops.push(op);
      return { removedSet: false, flushSetCount };
    }
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const flushSetCount = flushVirtualRegs(rewrite, virtualRegs);

      rewrite.ops.push(op);
      return { removedSet: false, flushSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedOpResult;
  }
}

function rewriteGet32(
  op: Extract<IrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: ReadonlyMap<Reg32, JitVirtualValue>
): void {
  const value = jitVirtualValueForStorage(op.source, instruction.operands, virtualRegs);

  if (value === undefined || !jitStorageHasVirtualRegister(op.source, instruction.operands, virtualRegs)) {
    rewrite.ops.push(op);
  } else {
    emitJitVirtualValueToVar(rewrite, op.dst, value);
  }

  const sourceValue = value ?? jitVirtualValueForStorage(op.source, instruction.operands);

  if (sourceValue !== undefined) {
    rewrite.localValues.set(op.dst.id, sourceValue);
  }
}

function recordBinaryValue(
  op: Extract<IrOp, { op: "i32.add" | "i32.sub" | "i32.xor" | "i32.or" | "i32.and" }>,
  rewrite: JitVirtualRewrite
): void {
  const a = jitVirtualValueForValue(op.a, rewrite.localValues);
  const b = jitVirtualValueForValue(op.b, rewrite.localValues);

  if (a !== undefined && b !== undefined) {
    rewrite.localValues.set(op.dst.id, { kind: op.op, a, b });
  }
}

function rewriteSet32(
  op: Extract<IrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>
): RewriteResult {
  const target = jitStorageReg(op.target, instruction.operands);
  const value = jitVirtualValueForValue(op.value, rewrite.localValues);
  const flushSetCount = target === undefined
    ? 0
    : flushVirtualRegsDependingOn(rewrite, virtualRegs, target);

  if (target !== undefined && value !== undefined) {
    virtualRegs.set(target, value);
    return { removedSet: true, flushSetCount };
  }

  if (target !== undefined) {
    virtualRegs.delete(target);
  }

  rewrite.ops.push(op);
  return { removedSet: false, flushSetCount };
}
