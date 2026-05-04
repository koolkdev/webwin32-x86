import type { Reg32 } from "#x86/isa/types.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import { jitIrOpIsTerminator } from "#backends/wasm/jit/ir-semantics.js";
import { JitValueTracker } from "#backends/wasm/jit/ir/value-tracker.js";
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
import {
  analyzeJitBarriers,
  jitInstructionHasBarrier,
  jitOpBarriersAt,
  jitOpHasBarrier,
  type JitBarrierAnalysis
} from "#backends/wasm/jit/optimization/analyses/barriers.js";

export type JitRegisterValueProducer = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reg: Reg32;
  value: JitValue;
  retained: boolean;
}>;

export type JitRegisterValueRead = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reg: Reg32;
  value: JitValue;
  folded: boolean;
  reason: "get32" | "address32";
}>;

export type JitRegisterValueFold = Readonly<{
  instructionIndex: number;
  opIndex: number;
  kind: "get32" | "address32";
  value: JitValue;
  regs: readonly Reg32[];
}>;

export type JitRegisterMaterializationReason =
  | "preInstructionExit"
  | "exit"
  | "read"
  | "clobber"
  | "conditionalWrite"
  | "blockEnd"
  | "policy";

export type JitRegisterMaterialization = Readonly<{
  instructionIndex: number;
  opIndex?: number;
  phase: "beforeInstruction" | "beforeOp" | "beforeExit" | "blockEnd";
  reason: JitRegisterMaterializationReason;
  regs: readonly Reg32[];
  values: readonly JitRegisterMaterializedValue[];
}>;

export type JitRegisterMaterializedValue = Readonly<{
  reg: Reg32;
  value: JitValue;
}>;

export type JitRegisterValueAnalysis = Readonly<{
  producers: readonly JitRegisterValueProducer[];
  reads: readonly JitRegisterValueRead[];
  folds: readonly JitRegisterValueFold[];
  materializations: readonly JitRegisterMaterialization[];
  finalValues: ReadonlyMap<Reg32, JitValue>;
}>;

export function analyzeJitRegisterValues(
  block: JitIrBlock,
  barriers: JitBarrierAnalysis = analyzeJitBarriers(block)
): JitRegisterValueAnalysis {
  const registers = new JitRegisterValues();
  const producers: JitRegisterValueProducer[] = [];
  const reads: JitRegisterValueRead[] = [];
  const folds: JitRegisterValueFold[] = [];
  const materializations: JitRegisterMaterialization[] = [];

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing register values: ${instructionIndex}`);
    }

    if (jitInstructionHasBarrier(barriers, instructionIndex, "preInstructionExit")) {
      materializeAll(registers, materializations, {
        instructionIndex,
        phase: "beforeInstruction",
        reason: "preInstructionExit"
      });
    }

    analyzeInstruction(block, instruction, instructionIndex, registers, producers, reads, folds, materializations, barriers);
  }

  return {
    producers,
    reads,
    folds,
    materializations,
    finalValues: new Map(registers.trackedValues)
  };
}

export function validateJitRegisterValueAnalysis(analysis: JitRegisterValueAnalysis): void {
  for (const materialization of analysis.materializations) {
    const remainingRegs = new Set(materialization.regs);

    for (const { reg } of materialization.values) {
      if (!remainingRegs.delete(reg)) {
        throw new Error(`register materialization has unexpected value for ${reg}`);
      }
    }

    if (remainingRegs.size !== 0) {
      throw new Error(`register materialization is missing values for ${[...remainingRegs].join(", ")}`);
    }
  }
}

function analyzeInstruction(
  block: JitIrBlock,
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  registers: JitRegisterValues,
  producers: JitRegisterValueProducer[],
  reads: JitRegisterValueRead[],
  folds: JitRegisterValueFold[],
  materializations: JitRegisterMaterialization[],
  barriers: JitBarrierAnalysis
): void {
  const values = new JitValueTracker();

  for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
    const op = instruction.ir[opIndex];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while analyzing register values: ${instructionIndex}:${opIndex}`);
    }

    if (isFinalBlockTerminatorWithoutExit(block, barriers, instructionIndex, opIndex, op)) {
      materializeAll(registers, materializations, {
        instructionIndex,
        opIndex,
        phase: "beforeOp",
        reason: "blockEnd"
      });
    }

    switch (op.op) {
      case "get32": {
        const reg = jitStorageReg(op.source, instruction.operands);
        const value = registers.valueForStorage(op.source, instruction.operands);

        if (reg !== undefined && value !== undefined && registers.hasStorageValue(op.source, instruction.operands)) {
          if (shouldMaterializeRepeatedRegisterRead(reg, value, registers)) {
            materializeRegs(registers, materializations, [reg], {
              instructionIndex,
              opIndex,
              phase: "beforeOp",
              reason: "policy"
            });
            reads.push({ instructionIndex, opIndex, reg, value, folded: false, reason: "get32" });
          } else {
            registers.recordRead(reg);
            reads.push({ instructionIndex, opIndex, reg, value, folded: true, reason: "get32" });
            folds.push({ instructionIndex, opIndex, kind: "get32", value, regs: [reg] });
          }
        }

        values.recordOp(op, instruction, registers.trackedValues);
        break;
      }
      case "address32": {
        const readRegs = registers.regsReadByEffectiveAddress(op.operand, instruction.operands);
        const repeatedRegs = readRegs.filter((reg) => {
          const value = registers.get(reg);

          return value !== undefined && shouldMaterializeRepeatedRegisterRead(reg, value, registers);
        });

        materializeRegs(registers, materializations, repeatedRegs, {
          instructionIndex,
          opIndex,
          phase: "beforeOp",
          reason: "policy"
        });

        const value = registers.valueForEffectiveAddress(op.operand, instruction.operands);

        if (value === undefined) {
          materializeRegs(registers, materializations, readRegs, {
            instructionIndex,
            opIndex,
            phase: "beforeOp",
            reason: "read"
          });
        } else {
          folds.push({ instructionIndex, opIndex, kind: "address32", value, regs: readRegs });

          for (const reg of readRegs) {
            const regValue = registers.get(reg);

            if (regValue !== undefined) {
              registers.recordRead(reg);
              reads.push({ instructionIndex, opIndex, reg, value: regValue, folded: true, reason: "address32" });
            }
          }
        }

        values.recordOp(op, instruction, registers.trackedValues);
        break;
      }
      case "set32": {
        const reg = registerBarrierReg(barriers, instructionIndex, opIndex, "write");
        const value = values.valueFor(op.value);
        const retained = reg !== undefined &&
          value !== undefined &&
          shouldRetainRegisterValue(value) &&
          !isImmediatelyMaterializedAtExit(instruction, instructionIndex, opIndex, barriers);

        if (reg !== undefined) {
          materializeDependencies(registers, materializations, reg, {
            instructionIndex,
            opIndex,
            phase: "beforeOp",
            reason: "clobber"
          });

          if (retained && value !== undefined) {
            registers.set(reg, value);
          } else {
            registers.delete(reg);
          }

          if (value !== undefined) {
            producers.push({ instructionIndex, opIndex, reg, value, retained });
          }
        }
        break;
      }
      case "set32.if": {
        const reg = registerBarrierReg(barriers, instructionIndex, opIndex, "conditionalWrite");

        if (reg !== undefined) {
          materializeRegs(registers, materializations, [reg], {
            instructionIndex,
            opIndex,
            phase: "beforeOp",
            reason: "conditionalWrite"
          });
          materializeDependencies(registers, materializations, reg, {
            instructionIndex,
            opIndex,
            phase: "beforeOp",
            reason: "clobber"
          });
          registers.delete(reg);
        }
        break;
      }
      case "set32.materialize": {
        const reg = registerBarrierReg(barriers, instructionIndex, opIndex, "write");

        if (reg !== undefined) {
          materializeDependencies(registers, materializations, reg, {
            instructionIndex,
            opIndex,
            phase: "beforeOp",
            reason: "clobber"
          });
          registers.delete(reg);
        }
        break;
      }
      default:
        values.recordOp(op, instruction, registers.trackedValues);
        break;
    }

    if (jitOpHasBarrier(barriers, instructionIndex, opIndex, "exit")) {
      materializeAll(registers, materializations, {
        instructionIndex,
        opIndex,
        phase: "beforeExit",
        reason: "exit"
      });
    }
  }
}

function materializeAll(
  registers: JitRegisterValues,
  materializations: JitRegisterMaterialization[],
  point: Omit<JitRegisterMaterialization, "regs" | "values">
): void {
  materializeRegs(registers, materializations, [...registers.trackedValues.keys()], point);
}

function materializeDependencies(
  registers: JitRegisterValues,
  materializations: JitRegisterMaterialization[],
  clobberedReg: Reg32,
  point: Omit<JitRegisterMaterialization, "regs" | "values">
): void {
  const regs = [...registers.trackedValues].flatMap(([reg, value]) =>
    reg !== clobberedReg && jitValueReadsReg(value, clobberedReg) ? [reg] : []
  );

  materializeRegs(registers, materializations, regs, point);
}

function materializeRegs(
  registers: JitRegisterValues,
  materializations: JitRegisterMaterialization[],
  regs: readonly Reg32[],
  point: Omit<JitRegisterMaterialization, "regs" | "values">
): void {
  const values = regs.flatMap((reg) => {
    const value = registers.get(reg);

    return value === undefined ? [] : [{ reg, value }];
  });

  if (values.length === 0) {
    return;
  }

  materializations.push({
    ...point,
    regs: values.map(({ reg }) => reg),
    values
  });

  for (const { reg } of values) {
    registers.delete(reg);
  }
}

function registerBarrierReg(
  barriers: JitBarrierAnalysis,
  instructionIndex: number,
  opIndex: number,
  reason: "write" | "conditionalWrite"
): Reg32 | undefined {
  return jitOpBarriersAt(barriers, instructionIndex, opIndex)
    .find((barrier) => barrier.reason === reason)
    ?.reg;
}

function isImmediatelyMaterializedAtExit(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  barriers: JitBarrierAnalysis
): boolean {
  const nextOpIndex = opIndex + 1;
  const nextOp = instruction.ir[nextOpIndex];

  return nextOp !== undefined &&
    jitIrOpIsTerminator(nextOp) &&
    jitOpHasBarrier(barriers, instructionIndex, nextOpIndex, "exit");
}

function isFinalBlockTerminatorWithoutExit(
  block: JitIrBlock,
  barriers: JitBarrierAnalysis,
  instructionIndex: number,
  opIndex: number,
  op: JitIrOp
): boolean {
  const instruction = block.instructions[instructionIndex];

  return instructionIndex === block.instructions.length - 1 &&
    instruction !== undefined &&
    opIndex === instruction.ir.length - 1 &&
    jitIrOpIsTerminator(op) &&
    !jitOpHasBarrier(barriers, instructionIndex, opIndex, "exit");
}
