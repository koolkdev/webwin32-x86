import {
  IR_ALU_FLAG_MASK
} from "#x86/ir/passes/flag-analysis.js";
import {
  createAluFlagsConditionSpecializationPass,
  createDeadFlagSetPruningPass,
  createFlagMaterializationPass
} from "#x86/ir/passes/flag-optimization.js";
import { optimizeIrBlock } from "#x86/ir/passes/optimization.js";
import { isIrTerminatorOp } from "#x86/ir/model/ops.js";
import type { IrBlock, IrOp, OperandRef, StorageRef, ValueRef, VarRef } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import { optimizeJitIrBlock, type JitBlockOptimization } from "#backends/wasm/jit/optimization/optimize.js";
import type {
  JitFlatLoweringBlock,
  JitIrBlock,
  JitIrBlockInstructionMetadata
} from "#backends/wasm/jit/types.js";

const emptyBoundaryMaskByOpIndex = new Map<number, number>();

export function prepareJitIrBlockForLowering(
  block: JitIrBlock,
  optimization: JitBlockOptimization = optimizeJitIrBlock(block)
): JitFlatLoweringBlock {
  return optimizeJitFlatLoweringBlock(buildJitFlatLoweringBlock(insertExitFlagBoundaries(block, optimization)));
}

function optimizeJitFlatLoweringBlock(block: JitFlatLoweringBlock): JitFlatLoweringBlock {
  const optimized = optimizeIrBlock(block.ir, [
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

function buildJitFlatLoweringBlock(block: JitIrBlock): JitFlatLoweringBlock {
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

function insertExitFlagBoundaries(block: JitIrBlock, optimization: JitBlockOptimization): JitIrBlock {
  const boundaryMasks = exitFlagBoundaryMasks(optimization);

  if (boundaryMasks.size === 0) {
    return block;
  }

  return {
    instructions: block.instructions.map((instruction, instructionIndex) => ({
      ...instruction,
      ir: insertInstructionFlagBoundaries(
        instruction.ir,
        boundaryMasks.get(instructionIndex) ?? emptyBoundaryMaskByOpIndex
      )
    }))
  };
}

function exitFlagBoundaryMasks(optimization: JitBlockOptimization): ReadonlyMap<number, ReadonlyMap<number, number>> {
  const masks = new Map<number, Map<number, number>>();

  for (const exit of optimization.exitPoints) {
    let instructionMasks = masks.get(exit.instructionIndex);

    if (instructionMasks === undefined) {
      instructionMasks = new Map();
      masks.set(exit.instructionIndex, instructionMasks);
    }

    instructionMasks.set(exit.opIndex, (instructionMasks.get(exit.opIndex) ?? 0) | IR_ALU_FLAG_MASK);
  }

  return masks;
}

function insertInstructionFlagBoundaries(
  block: IrBlock,
  boundaryMasks: ReadonlyMap<number, number>
): IrBlock {
  const ops: IrOp[] = [];

  for (let index = 0; index < block.length; index += 1) {
    const boundaryMask = boundaryMasks.get(index);

    if (boundaryMask !== undefined) {
      ops.push({ op: "flags.boundary", mask: boundaryMask });
    }

    const op = block[index];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while inserting JIT exit flag boundary: ${index}`);
    }

    ops.push(op);
  }

  return ops;
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
