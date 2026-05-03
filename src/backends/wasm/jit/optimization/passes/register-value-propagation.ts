import type { Reg32 } from "#x86/isa/types.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationPass } from "#backends/wasm/jit/optimization/pass.js";
import {
  indexJitEffects,
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "#backends/wasm/jit/ir/effects.js";
import { jitIrOpIsTerminator } from "#backends/wasm/jit/ir-semantics.js";
import {
  assignJitValue,
  materializeJitRegisterValue,
  createJitInstructionRewrite,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "#backends/wasm/jit/ir/rewrite.js";
import {
  jitStorageReg,
  jitValueReadsReg,
  type JitValue
} from "#backends/wasm/jit/ir/values.js";
import { JitRegisterValues } from "#backends/wasm/jit/optimization/registers/values.js";
import {
  shouldMaterializeRepeatedRegisterRead,
  shouldRetainRegisterValue
} from "#backends/wasm/jit/optimization/registers/policy.js";

export type JitRegisterValuePropagation = Readonly<{
  removedSetCount: number;
  foldedReadCount: number;
  foldedAddressCount: number;
  materializedSetCount: number;
}>;

export const registerValuePropagationPass = {
  name: "register-value-propagation",
  run(block) {
    const result = propagateJitRegisterValues(block);

    return {
      block: result.block,
      changed: result.registerValues.removedSetCount !== 0 ||
        result.registerValues.foldedReadCount !== 0 ||
        result.registerValues.foldedAddressCount !== 0 ||
        result.registerValues.materializedSetCount !== 0,
      stats: result.registerValues
    };
  }
} satisfies JitOptimizationPass<"register-value-propagation">;

export function propagateJitRegisterValues(block: JitIrBlock): Readonly<{
  block: JitIrBlock;
  registerValues: JitRegisterValuePropagation;
}> {
  const effects = indexJitEffects(block);
  const registers = new JitRegisterValues();
  const stats = mutableStats();
  const instructions = block.instructions.map((instruction, instructionIndex) =>
    propagateInstructionRegisterValues(block, instruction, instructionIndex, effects, registers, stats)
  );

  return {
    block: { instructions },
    registerValues: stats
  };
}

function propagateInstructionRegisterValues(
  block: JitIrBlock,
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  effects: ReturnType<typeof indexJitEffects>,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): JitIrBlockInstruction {
  const rewrite = createJitInstructionRewrite(instruction);

  if (jitInstructionHasPreInstructionExit(effects, instructionIndex)) {
    stats.materializedSetCount += materializeAllRegisters(rewrite, registers);
  }

  rewriteJitIrInstructionInto(
    instruction,
    instructionIndex,
    "propagating JIT register values",
    rewrite,
    ({ op, opIndex }) => {
      const isFinalTerminator = instructionIndex === block.instructions.length - 1 &&
        opIndex === instruction.ir.length - 1 &&
        jitIrOpIsTerminator(op);

      if (isFinalTerminator && !jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
        stats.materializedSetCount += materializeAllRegisters(rewrite, registers);
      }

      propagateOp(instruction, instructionIndex, op, opIndex, effects, rewrite, registers, stats);
    }
  );

  return {
    ...instruction,
    ir: rewrite.ops
  };
}

function propagateOp(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  op: JitIrOp,
  opIndex: number,
  effects: ReturnType<typeof indexJitEffects>,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const hasPostInstructionExit = jitOpHasPostInstructionExit(effects, instructionIndex, opIndex);

  if (hasPostInstructionExit && jitIrOpIsTerminator(op)) {
    stats.materializedSetCount += materializeAllRegisters(rewrite, registers);
  }

  switch (op.op) {
    case "get32":
      propagateGet32(instruction, op, rewrite, registers, stats);
      break;
    case "address32":
      propagateAddress32(instruction, op, rewrite, registers, stats);
      break;
    case "set32":
      propagateSet32(instruction, instructionIndex, op, opIndex, effects, rewrite, registers, stats);
      break;
    case "set32.if":
      propagateSet32If(instruction, op, rewrite, registers, stats);
      break;
    default:
      copyOp(instruction, op, rewrite, registers);
      break;
  }

  if (hasPostInstructionExit && !jitIrOpIsTerminator(op)) {
    stats.materializedSetCount += materializeAllRegisters(rewrite, registers);
  }
}

function propagateGet32(
  instruction: JitIrBlockInstruction,
  op: Extract<JitIrOp, { op: "get32" }>,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const reg = jitStorageReg(op.source, instruction.operands);
  const value = registers.valueForStorage(op.source, instruction.operands);

  if (reg === undefined || value === undefined || !registers.hasStorageValue(op.source, instruction.operands)) {
    copyOp(instruction, op, rewrite, registers);
    return;
  }

  if (shouldMaterializeRepeatedRegisterRead(reg, value, registers)) {
    stats.materializedSetCount += materializeRegisters(rewrite, registers, [reg]);
    copyOp(instruction, op, rewrite, registers);
    return;
  }

  registers.recordRead(reg);
  assignTrackedValue(rewrite, op.dst.id, op.dst, value);
  stats.foldedReadCount += 1;
}

function propagateAddress32(
  instruction: JitIrBlockInstruction,
  op: Extract<JitIrOp, { op: "address32" }>,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const repeatedRegs = registers.regsReadByEffectiveAddress(op.operand, instruction.operands)
    .filter((reg) => {
      const value = registers.get(reg);

      return value !== undefined && shouldMaterializeRepeatedRegisterRead(reg, value, registers);
    });

  stats.materializedSetCount += materializeRegisters(rewrite, registers, repeatedRegs);

  const value = registers.valueForEffectiveAddress(op.operand, instruction.operands);

  if (value === undefined) {
    stats.materializedSetCount += materializeRegisters(
      rewrite,
      registers,
      registers.regsReadByEffectiveAddress(op.operand, instruction.operands)
    );
    copyOp(instruction, op, rewrite, registers);
    registers.syncReadCounts();
    return;
  }

  for (const reg of registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
    registers.recordRead(reg);
  }

  assignTrackedValue(rewrite, op.dst.id, op.dst, value);
  stats.foldedAddressCount += 1;
}

function propagateSet32(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  op: Extract<JitIrOp, { op: "set32" }>,
  opIndex: number,
  effects: ReturnType<typeof indexJitEffects>,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const reg = jitStorageReg(op.target, instruction.operands);
  const value = rewrite.values.valueFor(op.value);
  const retained = reg !== undefined &&
    value !== undefined &&
    shouldRetainRegisterValue(value) &&
    !isImmediatelyMaterializedAtExit(instruction, instructionIndex, opIndex, effects);

  if (reg === undefined) {
    copyOp(instruction, op, rewrite, registers);
    return;
  }

  stats.materializedSetCount += materializeDependencies(rewrite, registers, reg);

  if (retained && value !== undefined) {
    registers.set(reg, value);
    registers.syncReadCounts();
    stats.removedSetCount += 1;
    return;
  }

  registers.delete(reg);
  registers.syncReadCounts();
  copyOp(instruction, op, rewrite, registers);
}

function isImmediatelyMaterializedAtExit(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  effects: ReturnType<typeof indexJitEffects>
): boolean {
  const nextOpIndex = opIndex + 1;
  const nextOp = instruction.ir[nextOpIndex];

  return nextOp !== undefined &&
    jitIrOpIsTerminator(nextOp) &&
    jitOpHasPostInstructionExit(effects, instructionIndex, nextOpIndex);
}

function propagateSet32If(
  instruction: JitIrBlockInstruction,
  op: Extract<JitIrOp, { op: "set32.if" }>,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const reg = jitStorageReg(op.target, instruction.operands);

  if (reg !== undefined) {
    stats.materializedSetCount += materializeRegisters(rewrite, registers, [reg]);
    stats.materializedSetCount += materializeDependencies(rewrite, registers, reg);
    registers.delete(reg);
    registers.syncReadCounts();
  }

  copyOp(instruction, op, rewrite, registers);
}

function copyOp(
  instruction: JitIrBlockInstruction,
  op: JitIrOp,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): void {
  rewrite.ops.push(op);
  rewrite.values.recordOp(op, instruction, registers.trackedValues);
}

function assignTrackedValue(
  rewrite: JitInstructionRewrite,
  dstId: number,
  dst: Extract<JitIrOp, { op: "get32" | "address32" }>["dst"],
  value: JitValue
): void {
  assignJitValue(rewrite, dst, value);
  rewrite.values.record(dstId, value);
}

function materializeDependencies(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  clobberedReg: Reg32
): number {
  const regs = [...registers.trackedValues].flatMap(([reg, value]) =>
    reg !== clobberedReg && jitValueReadsReg(value, clobberedReg) ? [reg] : []
  );

  return materializeRegisters(rewrite, registers, regs);
}

function materializeAllRegisters(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): number {
  return materializeRegisters(rewrite, registers, [...registers.trackedValues.keys()]);
}

function materializeRegisters(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  regs: readonly Reg32[]
): number {
  let materializedSetCount = 0;

  for (const reg of regs) {
    const value = registers.get(reg);

    if (value === undefined) {
      continue;
    }

    materializeJitRegisterValue(rewrite, reg, value, { jitRole: "registerMaterialization" });
    registers.delete(reg);
    materializedSetCount += 1;
  }

  registers.syncReadCounts();
  return materializedSetCount;
}

type MutableJitRegisterValuePropagation = {
  removedSetCount: number;
  foldedReadCount: number;
  foldedAddressCount: number;
  materializedSetCount: number;
};

function mutableStats(): MutableJitRegisterValuePropagation {
  return {
    removedSetCount: 0,
    foldedReadCount: 0,
    foldedAddressCount: 0,
    materializedSetCount: 0
  };
}
