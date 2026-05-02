import { assertSirAluFlagMask, SIR_FLAG_MASK_NONE } from "./flag-analysis.js";
import { FLAG_PRODUCERS } from "./flags.js";
import type { FlagMask, SirOp, SirProgram, StorageRef, ValueRef, VarRef } from "./types.js";

export type ValidateSirOptions = Readonly<{
  operandCount?: number;
  terminatorMode?: "single" | "multi";
}>;

export function validateSirProgram(program: SirProgram, options: ValidateSirOptions = {}): void {
  const definedVars = new Set<number>();
  const terminatorMode = options.terminatorMode ?? "single";
  let terminatorCount = 0;
  let sawTerminator = false;

  for (const op of program) {
    if (sawTerminator && terminatorMode === "single") {
      throw new Error(`SIR op ${op.op} appears after terminator`);
    }

    validateOpUses(op, definedVars, options);
    defineOpVar(op, definedVars);

    if (isTerminator(op)) {
      terminatorCount += 1;
      sawTerminator = true;
    }
  }

  if (terminatorMode === "single" && terminatorCount !== 1) {
    throw new Error(`SIR program must contain exactly one terminator, got ${terminatorCount}`);
  }

  if (terminatorMode === "multi" && terminatorCount === 0) {
    throw new Error("SIR program must contain at least one terminator");
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
      validateFlagSet(op, definedVars);
      break;
    case "flags.materialize":
    case "flags.boundary":
      validateAluFlagOpMask(op.mask, op.op);
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

function validateAluFlagOpMask(mask: FlagMask, op: "flags.materialize" | "flags.boundary"): void {
  assertSirAluFlagMask(mask, `${op} mask`);

  if (mask === SIR_FLAG_MASK_NONE) {
    throw new Error(`${op} requires a nonzero aluFlags mask`);
  }
}

function validateFlagSet(
  op: Extract<SirOp, { op: "flags.set" }>,
  definedVars: ReadonlySet<number>
): void {
  const producer = FLAG_PRODUCERS[op.producer];
  const expectedInputs: ReadonlySet<string> = new Set(producer.inputs);

  assertSirAluFlagMask(op.writtenMask, "flags.set writtenMask");
  assertSirAluFlagMask(op.undefMask, "flags.set undefMask");

  if (op.writtenMask !== producer.writtenMask) {
    throw new Error(`flags.set ${op.producer} writtenMask does not match producer metadata`);
  }

  if (op.undefMask !== producer.undefMask) {
    throw new Error(`flags.set ${op.producer} undefMask does not match producer metadata`);
  }

  if ((op.undefMask & ~op.writtenMask) !== 0) {
    throw new Error(`flags.set ${op.producer} undefMask must be contained in writtenMask`);
  }

  for (const inputName of producer.inputs) {
    const value = op.inputs[inputName];

    if (value === undefined) {
      throw new Error(`flags.set ${op.producer} is missing input '${inputName}'`);
    }

    validateValueRef(value, definedVars);
  }

  for (const inputName of Object.keys(op.inputs)) {
    if (!expectedInputs.has(inputName)) {
      throw new Error(`flags.set ${op.producer} has unexpected input '${inputName}'`);
    }
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
