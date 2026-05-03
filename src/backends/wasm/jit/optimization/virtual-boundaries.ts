import type { Reg32 } from "#x86/isa/types.js";
import { createJitVirtualRewrite, materializeJitVirtualReg, type JitVirtualRewrite } from "./virtual-rewrite.js";
import { jitVirtualValueReadsReg, type JitVirtualValue } from "./virtual-values.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";

export function materializeVirtualRegsReadingReg(
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  readReg: Reg32
): number {
  let materializedSetCount = 0;

  for (const [reg, value] of [...virtualRegs]) {
    if (reg !== readReg && jitVirtualValueReadsReg(value, readReg)) {
      materializeJitVirtualReg(rewrite, reg, value);
      virtualRegs.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function materializeAllVirtualRegs(
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>
): number {
  const materializedSetCount = virtualRegs.size;

  for (const [reg, value] of virtualRegs) {
    materializeJitVirtualReg(rewrite, reg, value);
  }

  virtualRegs.clear();
  return materializedSetCount;
}

export function materializeVirtualRegsForRead(
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  readRegs: readonly Reg32[]
): number {
  let materializedSetCount = 0;

  for (const reg of readRegs) {
    const value = virtualRegs.get(reg);

    if (value === undefined) {
      continue;
    }

    materializeJitVirtualReg(rewrite, reg, value);
    virtualRegs.delete(reg);
    materializedSetCount += 1;
  }

  return materializedSetCount;
}

export function materializeVirtualRegsIntoPreviousInstruction(
  instructions: JitIrBlockInstruction[],
  virtualRegs: ReadonlyMap<Reg32, JitVirtualValue>
): number {
  const previous = instructions[instructions.length - 1];

  if (previous === undefined) {
    if (virtualRegs.size !== 0) {
      throw new Error("cannot materialize JIT virtual registers before first instruction");
    }

    return 0;
  }

  const rewrite = createJitVirtualRewrite(previous);
  const terminatorIndex = previous.ir.length - 1;
  const terminator = previous.ir[terminatorIndex];

  if (terminator === undefined) {
    throw new Error("cannot materialize JIT virtual registers into empty instruction");
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
