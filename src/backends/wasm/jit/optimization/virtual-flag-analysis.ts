import { reg32, type Reg32 } from "#x86/isa/types.js";
import {
  conditionFlagReadMask,
  IR_ALU_FLAG_MASK
} from "#x86/ir/model/flag-effects.js";
import { FLAG_PRODUCERS } from "#x86/ir/model/flags.js";
import type {
  ConditionCode,
  IrFlagSetOp,
  StorageRef,
  ValueRef
} from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import {
  jitConditionUseAt,
  jitOpHasPostInstructionExit,
  jitPreInstructionExitReasonAt
} from "./effects.js";
import {
  JitFlagOwners,
  materializedJitFlagOwner,
  type JitVirtualFlagOwnerMask
} from "./flag-owners.js";
import type { JitConditionUse } from "./condition-uses.js";
import {
  jitStorageReg,
  jitValueReadRegs,
  type JitValue
} from "./values.js";
import { JitValueTracker } from "./value-tracker.js";

export type {
  JitVirtualFlagOwner,
  JitVirtualFlagOwnerMask
} from "./flag-owners.js";

export type JitVirtualFlagInput =
  | Readonly<{ kind: "value"; value: JitValue }>
  | Readonly<{ kind: "unmodeled" }>;

export type JitVirtualFlagSource = Readonly<{
  id: number;
  instructionIndex: number;
  opIndex: number;
  producer: IrFlagSetOp["producer"];
  writtenMask: number;
  undefMask: number;
  inputs: Readonly<Record<string, JitVirtualFlagInput>>;
  readRegs: readonly Reg32[];
}>;

export type JitVirtualFlagRead = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reason: "condition" | "materialize" | "boundary" | "preInstructionExit" | "exit";
  requiredMask: number;
  exitReason?: ExitReasonValue;
  cc?: ConditionCode;
  conditionUse?: JitConditionUse;
  owners: readonly JitVirtualFlagOwnerMask[];
}>;

export type JitVirtualFlagSourceClobber = Readonly<{
  instructionIndex: number;
  opIndex: number;
  reg: Reg32;
  owners: readonly JitVirtualFlagOwnerMask[];
}>;

export type JitVirtualFlagAnalysis = Readonly<{
  sources: readonly JitVirtualFlagSource[];
  reads: readonly JitVirtualFlagRead[];
  sourceClobbers: readonly JitVirtualFlagSourceClobber[];
  finalOwners: readonly JitVirtualFlagOwnerMask[];
}>;

export function analyzeJitVirtualFlags(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): JitVirtualFlagAnalysis {
  const owners = JitFlagOwners.incoming();
  const sources: JitVirtualFlagSource[] = [];
  const reads: JitVirtualFlagRead[] = [];
  const sourceClobbers: JitVirtualFlagSourceClobber[] = [];
  let nextSourceId = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing virtual flags: ${instructionIndex}`);
    }

    const values = new JitValueTracker();
    const instructionEntryOwners = owners.clone();

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing virtual flags: ${instructionIndex}:${opIndex}`);
      }

      analyzeOp(instructionIndex, opIndex, instruction, op, values, instructionEntryOwners);
    }
  }

  return {
    sources,
    reads,
    sourceClobbers,
    finalOwners: owners.forMask(IR_ALU_FLAG_MASK)
  };

  function analyzeOp(
    instructionIndex: number,
    opIndex: number,
    instruction: JitIrBlockInstruction,
    op: JitIrOp,
    values: JitValueTracker,
    instructionEntryOwners: JitFlagOwners
  ): void {
    const preInstructionExitReason = jitPreInstructionExitReasonAt(analysis.context.effects, instructionIndex, opIndex);

    if (preInstructionExitReason !== undefined) {
      recordRead({
        instructionIndex,
        opIndex,
        reason: "preInstructionExit",
        exitReason: preInstructionExitReason,
        requiredMask: IR_ALU_FLAG_MASK
      }, instructionEntryOwners);
    }

    if (jitOpHasPostInstructionExit(analysis.context.effects, instructionIndex, opIndex)) {
      recordRead({ instructionIndex, opIndex, reason: "exit", requiredMask: IR_ALU_FLAG_MASK });
    }

    if (values.recordOp(op, instruction)) {
      return;
    }

    switch (op.op) {
      case "set32":
      case "set32.if":
        recordSourceClobber(instructionIndex, opIndex, op.target, instruction);
        return;
      case "flags.set":
        recordFlagSource(instructionIndex, opIndex, op, values);
        return;
      case "aluFlags.condition": {
        const conditionUse = jitConditionUseAt(analysis.context.effects, instructionIndex, opIndex);

        if (conditionUse === undefined) {
          return;
        }

        recordRead({
          instructionIndex,
          opIndex,
          reason: "condition",
          requiredMask: conditionFlagReadMask(op.cc),
          cc: op.cc,
          conditionUse
        });
        return;
      }
      case "flags.materialize":
        recordRead({ instructionIndex, opIndex, reason: "materialize", requiredMask: op.mask });
        owners.set(op.mask, materializedJitFlagOwner);
        return;
      case "flags.boundary":
        recordRead({ instructionIndex, opIndex, reason: "boundary", requiredMask: op.mask });
        owners.set(op.mask, materializedJitFlagOwner);
        return;
      case "next":
      case "jump":
      case "conditionalJump":
      case "hostTrap":
        return;
      default:
        return;
    }
  }

  function recordFlagSource(
    instructionIndex: number,
    opIndex: number,
    op: IrFlagSetOp,
    values: JitValueTracker
  ): void {
    const inputs = flagInputs(op, values);
    const source: JitVirtualFlagSource = {
      id: nextSourceId,
      instructionIndex,
      opIndex,
      producer: op.producer,
      writtenMask: op.writtenMask,
      undefMask: op.undefMask,
      inputs,
      readRegs: flagInputReadRegs(inputs)
    };

    nextSourceId += 1;
    sources.push(source);
    owners.set(op.writtenMask | op.undefMask, { kind: "producer", source });
  }

  function recordRead(
    read: Omit<JitVirtualFlagRead, "owners">,
    readOwners: JitFlagOwners = owners
  ): void {
    if (read.requiredMask === 0) {
      return;
    }

    reads.push({
      ...read,
      owners: readOwners.forMask(read.requiredMask)
    });
  }

  function recordSourceClobber(
    instructionIndex: number,
    opIndex: number,
    storage: StorageRef,
    instruction: JitIrBlockInstruction
  ): void {
    const reg = jitStorageReg(storage, instruction.operands);

    if (reg === undefined) {
      return;
    }

    const clobberedOwners = owners.producerOwnersReadingReg(reg);

    if (clobberedOwners.length === 0) {
      return;
    }

    sourceClobbers.push({ instructionIndex, opIndex, reg, owners: clobberedOwners });
  }
}

function flagInputs(
  op: IrFlagSetOp,
  values: JitValueTracker
): Readonly<Record<string, JitVirtualFlagInput>> {
  return Object.fromEntries(
    FLAG_PRODUCERS[op.producer].inputs.map((inputName) => [
      inputName,
      flagInput(op.inputs[inputName], values)
    ])
  );
}

function flagInput(
  value: ValueRef | undefined,
  values: JitValueTracker
): JitVirtualFlagInput {
  if (value === undefined) {
    return { kind: "unmodeled" };
  }

  const jitValue = values.valueFor(value);

  return jitValue === undefined
    ? { kind: "unmodeled" }
    : { kind: "value", value: jitValue };
}

function flagInputReadRegs(inputs: Readonly<Record<string, JitVirtualFlagInput>>): readonly Reg32[] {
  const regs = new Set<Reg32>();

  for (const input of Object.values(inputs)) {
    if (input.kind === "value") {
      for (const reg of jitValueReadRegs(input.value)) {
        regs.add(reg);
      }
    }
  }

  return reg32.filter((reg) => regs.has(reg));
}
