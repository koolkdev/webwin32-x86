import {
  IR_ALU_FLAG_MASK
} from "#x86/ir/passes/flag-analysis.js";
import {
  createFlagBoundaryInsertionPass,
  createAluFlagsConditionSpecializationPass,
  createDeadFlagSetPruningPass,
  createFlagMaterializationPass,
  type IrFlagBoundaryPoint
} from "#x86/ir/passes/flag-optimization.js";
import { optimizeIrBlock } from "#x86/ir/passes/optimization.js";
import { isIrTerminatorOp } from "#x86/ir/model/ops.js";
import type { IrBlock, IrOp, OperandRef, StorageRef, ValueRef, VarRef } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import type {
  JitIrBlock,
  JitIrBlockInstructionMetadata,
  JitIrLoweringBlock
} from "#backends/wasm/jit/types.js";

export function prepareJitIrBlockForLowering(block: JitIrBlock): JitIrLoweringBlock {
  return optimizeJitIrLoweringBlock(flattenJitIrBlock(block));
}

function optimizeJitIrLoweringBlock(block: JitIrLoweringBlock): JitIrLoweringBlock {
  const optimized = optimizeIrBlock(block.ir, [
    createFlagBoundaryInsertionPass({
      points: (body) => jitFlagBoundaryPoints(body, block.operands)
    }),
    createAluFlagsConditionSpecializationPass(),
    createDeadFlagSetPruningPass(),
    createFlagMaterializationPass()
  ]);

  assertInstructionTerminatorCount(optimized.block, block.instructions);

  return {
    ir: optimized.block,
    operands: block.operands,
    instructions: block.instructions
  };
}

function flattenJitIrBlock(block: JitIrBlock): JitIrLoweringBlock {
  const ir: IrOp[] = [];
  const operands: JitOperandBinding[] = [];
  const instructions: JitIrBlockInstructionMetadata[] = [];
  let varBase = 0;

  for (const instruction of block.instructions) {
    const operandBase = operands.length;

    ir.push(...remapInstructionRefs(instruction.ir, operandBase, varBase));
    operands.push(...instruction.operands);
    instructions.push({
      instructionId: instruction.instructionId,
      eip: instruction.eip,
      nextEip: instruction.nextEip,
      nextMode: instruction.nextMode
    });
    varBase += instructionVarCount(instruction.ir);
  }

  return { ir, operands, instructions };
}

function remapInstructionRefs(block: IrBlock, operandBase: number, varBase: number): readonly IrOp[] {
  if (operandBase === 0 && varBase === 0) {
    return block;
  }

  return block.map((op) => remapOpRefs(op, operandBase, varBase));
}

function remapOpRefs(op: IrOp, operandBase: number, varBase: number): IrOp {
  switch (op.op) {
    case "get32":
      return {
        ...op,
        dst: remapVarRef(op.dst, varBase),
        source: remapStorageRefs(op.source, operandBase, varBase)
      };
    case "set32":
      return {
        ...op,
        target: remapStorageRefs(op.target, operandBase, varBase),
        value: remapValueRef(op.value, varBase)
      };
    case "address32":
      return {
        ...op,
        dst: remapVarRef(op.dst, varBase),
        operand: remapOperandRef(op.operand, operandBase)
      };
    case "const32":
      return { ...op, dst: remapVarRef(op.dst, varBase) };
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      return {
        ...op,
        dst: remapVarRef(op.dst, varBase),
        a: remapValueRef(op.a, varBase),
        b: remapValueRef(op.b, varBase)
      };
    case "flags.set":
      return { ...op, inputs: remapValueRefs(op.inputs, varBase) };
    case "flagProducer.condition":
      return {
        ...op,
        dst: remapVarRef(op.dst, varBase),
        inputs: remapValueRefs(op.inputs, varBase)
      };
    case "aluFlags.condition":
      return { ...op, dst: remapVarRef(op.dst, varBase) };
    case "jump":
      return { ...op, target: remapValueRef(op.target, varBase) };
    case "conditionalJump":
      return {
        ...op,
        condition: remapValueRef(op.condition, varBase),
        taken: remapValueRef(op.taken, varBase),
        notTaken: remapValueRef(op.notTaken, varBase)
      };
    case "hostTrap":
      return { ...op, vector: remapValueRef(op.vector, varBase) };
    default:
      return op;
  }
}

function remapStorageRefs(storage: StorageRef, operandBase: number, varBase: number): StorageRef {
  switch (storage.kind) {
    case "operand":
      return remapOperandRef(storage, operandBase);
    case "reg":
      return storage;
    case "mem":
      return { ...storage, address: remapValueRef(storage.address, varBase) };
  }
}

function remapOperandRef(operand: OperandRef, operandBase: number): OperandRef {
  return {
    kind: "operand",
    index: operandBase + operand.index
  };
}

function remapValueRefs(inputs: Readonly<Record<string, ValueRef>>, varBase: number): Readonly<Record<string, ValueRef>> {
  if (varBase === 0) {
    return inputs;
  }

  const remapped: Record<string, ValueRef> = {};

  for (const [key, value] of Object.entries(inputs)) {
    remapped[key] = remapValueRef(value, varBase);
  }

  return remapped;
}

function remapValueRef(value: ValueRef, varBase: number): ValueRef {
  if (value.kind !== "var" || varBase === 0) {
    return value;
  }

  return remapVarRef(value, varBase);
}

function remapVarRef(value: VarRef, varBase: number): VarRef {
  if (varBase === 0) {
    return value;
  }

  return {
    kind: "var",
    id: varBase + value.id
  };
}

function instructionVarCount(block: IrBlock): number {
  let maxId = -1;

  for (const op of block) {
    maxId = Math.max(maxId, maxIrOpVarId(op));
  }

  return maxId + 1;
}

function maxIrOpVarId(op: IrOp): number {
  switch (op.op) {
    case "get32":
      return Math.max(op.dst.id, maxStorageVarId(op.source));
    case "set32":
      return Math.max(maxStorageVarId(op.target), maxValueVarId(op.value));
    case "address32":
    case "const32":
    case "aluFlags.condition":
      return op.dst.id;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      return Math.max(op.dst.id, maxValueVarId(op.a), maxValueVarId(op.b));
    case "flags.set":
      return maxValueRefsVarId(op.inputs);
    case "flagProducer.condition":
      return Math.max(op.dst.id, maxValueRefsVarId(op.inputs));
    case "jump":
      return maxValueVarId(op.target);
    case "conditionalJump":
      return Math.max(maxValueVarId(op.condition), maxValueVarId(op.taken), maxValueVarId(op.notTaken));
    case "hostTrap":
      return maxValueVarId(op.vector);
    case "flags.materialize":
    case "flags.boundary":
    case "next":
      return -1;
  }
}

function maxStorageVarId(storage: StorageRef): number {
  return storage.kind === "mem" ? maxValueVarId(storage.address) : -1;
}

function maxValueRefsVarId(inputs: Readonly<Record<string, ValueRef>>): number {
  let maxId = -1;

  for (const value of Object.values(inputs)) {
    maxId = Math.max(maxId, maxValueVarId(value));
  }

  return maxId;
}

function maxValueVarId(value: ValueRef): number {
  return value.kind === "var" ? value.id : -1;
}

function assertInstructionTerminatorCount(
  block: IrBlock,
  instructions: readonly JitIrBlockInstructionMetadata[]
): void {
  const terminatorCount = block.filter(isIrTerminatorOp).length;

  if (terminatorCount !== instructions.length) {
    throw new Error(
      `optimized JIT IR instruction terminator count mismatch: ${terminatorCount} !== ${instructions.length}`
    );
  }
}

function jitFlagBoundaryPoints(
  block: IrBlock,
  operands: readonly JitOperandBinding[]
): readonly IrFlagBoundaryPoint[] {
  const points: IrFlagBoundaryPoint[] = [];

  for (let index = 0; index < block.length; index += 1) {
    const op = block[index];

    if (op === undefined) {
      throw new Error(`missing IR op while planning JIT flag boundaries: ${index}`);
    }

    if (opMayFaultBeforeCompletion(op, operands)) {
      points.push({ index, placement: "before", mask: IR_ALU_FLAG_MASK });
    }
  }

  if (block.length !== 0) {
    points.push({
      index: block.length - 1,
      placement: "before",
      mask: IR_ALU_FLAG_MASK
    });
  }

  return points;
}

function opMayFaultBeforeCompletion(op: IrOp, operands: readonly JitOperandBinding[]): boolean {
  switch (op.op) {
    case "get32":
      return storageMayAccessMemory(op.source, operands);
    case "set32":
      return storageMayAccessMemory(op.target, operands);
    default:
      return false;
  }
}

function storageMayAccessMemory(storage: StorageRef, operands: readonly JitOperandBinding[]): boolean {
  switch (storage.kind) {
    case "mem":
      return true;
    case "reg":
      return false;
    case "operand":
      return operands[storage.index]?.kind === "static.mem32";
  }
}
