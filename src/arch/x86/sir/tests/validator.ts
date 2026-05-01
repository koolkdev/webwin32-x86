import type { SirOp, SirProgram, StorageRef, ValueRef, VarRef } from "../types.js";

export type ValidateSirOptions = Readonly<{
  operandCount?: number;
}>;

export function validateSirProgram(program: SirProgram, options: ValidateSirOptions = {}): void {
  const definedVars = new Set<number>();
  let terminatorCount = 0;
  let sawTerminator = false;

  for (const op of program) {
    if (sawTerminator) {
      throw new Error(`SIR op ${op.op} appears after terminator`);
    }

    validateOpUses(op, definedVars, options);
    defineOpVar(op, definedVars);

    if (isTerminator(op)) {
      terminatorCount += 1;
      sawTerminator = true;
    }
  }

  if (terminatorCount !== 1) {
    throw new Error(`SIR program must contain exactly one terminator, got ${terminatorCount}`);
  }
}

function validateOpUses(
  op: SirOp,
  definedVars: ReadonlySet<number>,
  options: ValidateSirOptions
): void {
  switch (op.op) {
    case "get32":
      validateStorageRef(op.source, definedVars, options);
      break;
    case "set32":
      validateStorageRef(op.target, definedVars, options);
      validateValueRef(op.value, definedVars);
      break;
    case "address32":
      validateOperandIndex(op.operand.index, options);
      break;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.and":
      validateValueRef(op.a, definedVars);
      validateValueRef(op.b, definedVars);
      break;
    case "flags.set":
      for (const value of Object.values(op.inputs)) {
        validateValueRef(value, definedVars);
      }
      break;
    case "flags.materialize":
      break;
    case "jump":
      validateValueRef(op.target, definedVars);
      break;
    case "conditionalJump":
      validateValueRef(op.condition, definedVars);
      validateValueRef(op.taken, definedVars);
      validateValueRef(op.notTaken, definedVars);
      break;
    case "hostTrap":
      validateValueRef(op.vector, definedVars);
      break;
  }
}

function defineOpVar(op: SirOp, definedVars: Set<number>): void {
  const dst = opDst(op);

  if (dst === undefined) {
    return;
  }

  if (definedVars.has(dst.id)) {
    throw new Error(`SIR var ${dst.id} is assigned more than once`);
  }

  definedVars.add(dst.id);
}

function opDst(op: SirOp): VarRef | undefined {
  switch (op.op) {
    case "get32":
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.and":
    case "condition":
      return op.dst;
    default:
      return undefined;
  }
}

function validateStorageRef(
  storage: StorageRef,
  definedVars: ReadonlySet<number>,
  options: ValidateSirOptions
): void {
  if (storage.kind === "operand") {
    validateOperandIndex(storage.index, options);
    return;
  }

  if (storage.kind === "mem") {
    validateValueRef(storage.address, definedVars);
  }
}

function validateValueRef(value: ValueRef, definedVars: ReadonlySet<number>): void {
  if (value.kind === "var" && !definedVars.has(value.id)) {
    throw new Error(`SIR var ${value.id} is used before definition`);
  }
}

function validateOperandIndex(index: number, options: ValidateSirOptions): void {
  if (options.operandCount === undefined) {
    return;
  }

  if (index >= options.operandCount) {
    throw new Error(`SIR operand ${index} does not exist in ${options.operandCount}-operand instruction`);
  }
}

function isTerminator(op: SirOp): boolean {
  return op.op === "next" || op.op === "jump" || op.op === "conditionalJump" || op.op === "hostTrap";
}
