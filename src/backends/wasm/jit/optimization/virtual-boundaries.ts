import type { Reg32 } from "#x86/isa/types.js";
import { jitMemoryFaultReason } from "./op-effects.js";
import { createJitVirtualRewrite, materializeJitVirtualReg, type JitVirtualRewrite } from "./virtual-rewrite.js";
import { jitVirtualValueReadsReg, type JitVirtualValue } from "./virtual-values.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";

export function flushVirtualRegsDependingOn(
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  clobberedReg: Reg32
): number {
  let flushSetCount = 0;

  for (const [reg, value] of [...virtualRegs]) {
    if (reg !== clobberedReg && jitVirtualValueReadsReg(value, clobberedReg)) {
      materializeJitVirtualReg(rewrite, reg, value);
      virtualRegs.delete(reg);
      flushSetCount += 1;
    }
  }

  return flushSetCount;
}

export function flushVirtualRegs(
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>
): number {
  const flushSetCount = virtualRegs.size;

  for (const [reg, value] of virtualRegs) {
    materializeJitVirtualReg(rewrite, reg, value);
  }

  virtualRegs.clear();
  return flushSetCount;
}

export function flushVirtualRegsIntoPreviousInstruction(
  instructions: JitIrBlockInstruction[],
  virtualRegs: ReadonlyMap<Reg32, JitVirtualValue>
): number {
  const previous = instructions[instructions.length - 1];

  if (previous === undefined) {
    if (virtualRegs.size !== 0) {
      throw new Error("cannot flush JIT virtual registers before first instruction");
    }

    return 0;
  }

  const rewrite = createJitVirtualRewrite(previous);
  const terminatorIndex = previous.ir.length - 1;
  const terminator = previous.ir[terminatorIndex];

  if (terminator === undefined) {
    throw new Error("cannot flush JIT virtual registers into empty instruction");
  }

  rewrite.ops.push(...previous.ir.slice(0, terminatorIndex));

  for (const [reg, value] of virtualRegs) {
    materializeJitVirtualReg(rewrite, reg, value);
  }

  rewrite.ops.push(terminator);
  instructions[instructions.length - 1] = {
    ...previous,
    ir: rewrite.ops
  };
  return virtualRegs.size;
}

export function instructionMayFault(instruction: JitIrBlockInstruction): boolean {
  return instruction.ir.some((op) => jitMemoryFaultReason(op, instruction.operands) !== undefined);
}

export function nextInstructionMayFault(instruction: JitIrBlockInstruction | undefined): boolean {
  return instruction !== undefined && instructionMayFault(instruction);
}
