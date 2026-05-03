import type { Reg32 } from "#x86/isa/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  indexJitEffects,
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "#backends/wasm/jit/ir/effects.js";
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
}>;

export type JitRegisterValueAnalysis = Readonly<{
  producers: readonly JitRegisterValueProducer[];
  reads: readonly JitRegisterValueRead[];
  materializations: readonly JitRegisterMaterialization[];
  finalValues: ReadonlyMap<Reg32, JitValue>;
}>;

export function analyzeJitRegisterValues(block: JitIrBlock): JitRegisterValueAnalysis {
  const effects = indexJitEffects(block);
  const registers = new JitRegisterValues();
  const producers: JitRegisterValueProducer[] = [];
  const reads: JitRegisterValueRead[] = [];
  const materializations: JitRegisterMaterialization[] = [];

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing register values: ${instructionIndex}`);
    }

    if (jitInstructionHasPreInstructionExit(effects, instructionIndex)) {
      materializeAll(registers, materializations, {
        instructionIndex,
        phase: "beforeInstruction",
        reason: "preInstructionExit"
      });
    }

    analyzeInstruction(instruction, instructionIndex, registers, producers, reads, materializations, effects);
  }

  if (registers.size !== 0 && block.instructions.length !== 0) {
    materializeAll(registers, materializations, {
      instructionIndex: block.instructions.length - 1,
      phase: "blockEnd",
      reason: "blockEnd"
    });
  }

  return {
    producers,
    reads,
    materializations,
    finalValues: new Map(registers.trackedValues)
  };
}

function analyzeInstruction(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  registers: JitRegisterValues,
  producers: JitRegisterValueProducer[],
  reads: JitRegisterValueRead[],
  materializations: JitRegisterMaterialization[],
  effects: ReturnType<typeof indexJitEffects>
): void {
  const values = new JitValueTracker();

  for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
    const op = instruction.ir[opIndex];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while analyzing register values: ${instructionIndex}:${opIndex}`);
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
        const reg = jitStorageReg(op.target, instruction.operands);
        const value = values.valueFor(op.value);
        const retained = reg !== undefined && value !== undefined && shouldRetainRegisterValue(value);

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
        const reg = jitStorageReg(op.target, instruction.operands);

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
      default:
        values.recordOp(op, instruction, registers.trackedValues);
        break;
    }

    if (jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
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
  point: Omit<JitRegisterMaterialization, "regs">
): void {
  materializeRegs(registers, materializations, [...registers.trackedValues.keys()], point);
}

function materializeDependencies(
  registers: JitRegisterValues,
  materializations: JitRegisterMaterialization[],
  clobberedReg: Reg32,
  point: Omit<JitRegisterMaterialization, "regs">
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
  point: Omit<JitRegisterMaterialization, "regs">
): void {
  const materializedRegs = regs.filter((reg) => registers.has(reg));

  if (materializedRegs.length === 0) {
    return;
  }

  materializations.push({
    ...point,
    regs: materializedRegs
  });

  for (const reg of materializedRegs) {
    registers.delete(reg);
  }
}
