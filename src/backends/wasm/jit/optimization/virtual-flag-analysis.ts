import { reg32, type Reg32 } from "#x86/isa/types.js";
import {
  conditionFlagReadMask,
  IR_ALU_FLAG_MASK,
  IR_ALU_FLAG_MASKS
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
} from "./boundaries.js";
import type { JitConditionUse } from "./condition-uses.js";
import {
  jitStorageReg,
  jitVirtualValueForValue,
  jitVirtualValueReadRegs,
  type JitVirtualValue
} from "./virtual-values.js";
import { recordJitVirtualLocalValue } from "./virtual-local-values.js";

export type JitVirtualFlagInput =
  | Readonly<{ kind: "value"; value: JitVirtualValue }>
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

export type JitVirtualFlagOwner =
  | Readonly<{ kind: "incoming" }>
  | Readonly<{ kind: "materialized" }>
  | Readonly<{ kind: "producer"; source: JitVirtualFlagSource }>;

export type JitVirtualFlagOwnerMask = Readonly<{
  mask: number;
  owner: JitVirtualFlagOwner;
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

const incomingFlagOwner: JitVirtualFlagOwner = { kind: "incoming" };
const materializedFlagOwner: JitVirtualFlagOwner = { kind: "materialized" };
const flagBits = Object.values(IR_ALU_FLAG_MASKS);

export function analyzeJitVirtualFlags(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): JitVirtualFlagAnalysis {
  const ownersByFlag = new Map<number, JitVirtualFlagOwner>(
    flagBits.map((flagBit) => [flagBit, incomingFlagOwner])
  );
  const sources: JitVirtualFlagSource[] = [];
  const reads: JitVirtualFlagRead[] = [];
  const sourceClobbers: JitVirtualFlagSourceClobber[] = [];
  let nextSourceId = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while analyzing virtual flags: ${instructionIndex}`);
    }

    const localValues = new Map<number, JitVirtualValue>();
    const instructionEntryOwners = new Map(ownersByFlag);

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while analyzing virtual flags: ${instructionIndex}:${opIndex}`);
      }

      analyzeOp(instructionIndex, opIndex, instruction, op, localValues, instructionEntryOwners);
    }
  }

  return {
    sources,
    reads,
    sourceClobbers,
    finalOwners: ownersForMask(ownersByFlag, IR_ALU_FLAG_MASK)
  };

  function analyzeOp(
    instructionIndex: number,
    opIndex: number,
    instruction: JitIrBlockInstruction,
    op: JitIrOp,
    localValues: Map<number, JitVirtualValue>,
    instructionEntryOwners: ReadonlyMap<number, JitVirtualFlagOwner>
  ): void {
    const preInstructionExitReason = jitPreInstructionExitReasonAt(analysis.boundaries, instructionIndex, opIndex);

    if (preInstructionExitReason !== undefined) {
      recordRead({
        instructionIndex,
        opIndex,
        reason: "preInstructionExit",
        exitReason: preInstructionExitReason,
        requiredMask: IR_ALU_FLAG_MASK
      }, instructionEntryOwners);
    }

    if (jitOpHasPostInstructionExit(analysis.boundaries, instructionIndex, opIndex)) {
      recordRead({ instructionIndex, opIndex, reason: "exit", requiredMask: IR_ALU_FLAG_MASK });
    }

    if (recordJitVirtualLocalValue(op, instruction, localValues)) {
      return;
    }

    switch (op.op) {
      case "set32":
      case "set32.if":
        recordSourceClobber(instructionIndex, opIndex, op.target, instruction);
        return;
      case "flags.set":
        recordFlagSource(instructionIndex, opIndex, op, localValues);
        return;
      case "aluFlags.condition": {
        const conditionUse = jitConditionUseAt(analysis.boundaries, instructionIndex, opIndex);

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
        setOwner(op.mask, materializedFlagOwner);
        return;
      case "flags.boundary":
        recordRead({ instructionIndex, opIndex, reason: "boundary", requiredMask: op.mask });
        setOwner(op.mask, materializedFlagOwner);
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
    localValues: ReadonlyMap<number, JitVirtualValue>
  ): void {
    const inputs = flagInputs(op, localValues);
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
    setOwner(op.writtenMask | op.undefMask, { kind: "producer", source });
  }

  function setOwner(mask: number, owner: JitVirtualFlagOwner): void {
    for (const flagBit of flagBits) {
      if ((mask & flagBit) !== 0) {
        ownersByFlag.set(flagBit, owner);
      }
    }
  }

  function recordRead(
    read: Omit<JitVirtualFlagRead, "owners">,
    readOwners: ReadonlyMap<number, JitVirtualFlagOwner> = ownersByFlag
  ): void {
    if (read.requiredMask === 0) {
      return;
    }

    reads.push({
      ...read,
      owners: ownersForMask(readOwners, read.requiredMask)
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

    const owners = producerOwnersReadingReg(ownersByFlag, reg);

    if (owners.length === 0) {
      return;
    }

    sourceClobbers.push({ instructionIndex, opIndex, reg, owners });
  }
}

function flagInputs(
  op: IrFlagSetOp,
  localValues: ReadonlyMap<number, JitVirtualValue>
): Readonly<Record<string, JitVirtualFlagInput>> {
  return Object.fromEntries(
    FLAG_PRODUCERS[op.producer].inputs.map((inputName) => [
      inputName,
      flagInput(op.inputs[inputName], localValues)
    ])
  );
}

function flagInput(
  value: ValueRef | undefined,
  localValues: ReadonlyMap<number, JitVirtualValue>
): JitVirtualFlagInput {
  if (value === undefined) {
    return { kind: "unmodeled" };
  }

  const virtualValue = jitVirtualValueForValue(value, localValues);

  return virtualValue === undefined
    ? { kind: "unmodeled" }
    : { kind: "value", value: virtualValue };
}

function flagInputReadRegs(inputs: Readonly<Record<string, JitVirtualFlagInput>>): readonly Reg32[] {
  const regs = new Set<Reg32>();

  for (const input of Object.values(inputs)) {
    if (input.kind === "value") {
      for (const reg of jitVirtualValueReadRegs(input.value)) {
        regs.add(reg);
      }
    }
  }

  return reg32.filter((reg) => regs.has(reg));
}

function producerOwnersReadingReg(
  ownersByFlag: ReadonlyMap<number, JitVirtualFlagOwner>,
  reg: Reg32
): readonly JitVirtualFlagOwnerMask[] {
  return ownersForMask(ownersByFlag, IR_ALU_FLAG_MASK).filter((entry) =>
    entry.owner.kind === "producer" && entry.owner.source.readRegs.includes(reg)
  );
}

function ownersForMask(
  ownersByFlag: ReadonlyMap<number, JitVirtualFlagOwner>,
  mask: number
): readonly JitVirtualFlagOwnerMask[] {
  const owners: JitVirtualFlagOwnerMask[] = [];

  for (const flagBit of flagBits) {
    if ((mask & flagBit) === 0) {
      continue;
    }

    const owner = ownersByFlag.get(flagBit) ?? incomingFlagOwner;
    const existingIndex = owners.findIndex((entry) => sameOwner(entry.owner, owner));

    if (existingIndex === -1) {
      owners.push({ mask: flagBit, owner });
    } else {
      const existing = owners[existingIndex]!;

      owners[existingIndex] = {
        mask: existing.mask | flagBit,
        owner: existing.owner
      };
    }
  }

  return owners;
}

function sameOwner(a: JitVirtualFlagOwner, b: JitVirtualFlagOwner): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  if (a.kind === "producer" && b.kind === "producer") {
    return a.source === b.source;
  }

  return true;
}
