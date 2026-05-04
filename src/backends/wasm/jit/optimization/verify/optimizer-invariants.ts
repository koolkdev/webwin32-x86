import { flagProducerConditionInputNames, requiredFlagProducerConditionInput } from "#x86/ir/model/flag-conditions.js";
import { assertIrAluFlagMask } from "#x86/ir/model/flag-effects.js";
import { FLAG_PRODUCERS } from "#x86/ir/model/flags.js";
import type { IrBlock, ValueRef } from "#x86/ir/model/types.js";
import { validateIrBlock } from "#x86/ir/passes/validator.js";
import { jitIrOpDst } from "#backends/wasm/jit/ir-semantics.js";
import type { JitIrBlock, JitIrBody, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  analyzeJitBarriers,
  jitOpBarriersAt,
  type JitBarrierAnalysis
} from "#backends/wasm/jit/optimization/analyses/barriers.js";

export type JitOptimizerVerificationPhase = "before-pass" | "after-pass" | "final";

export type JitOptimizerVerificationOptions = Readonly<{
  phase: JitOptimizerVerificationPhase;
  passName?: string;
}>;

export function verifyJitIrBlock(block: JitIrBlock, options: JitOptimizerVerificationOptions): void {
  const barriers = verifiedJitBarriers(block, options);

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`${verificationPrefix(options)} missing JIT instruction: ${instructionIndex}`);
    }

    try {
      validateIrBlock(jitValidationIrBlock(instruction.ir), {
        operandCount: instruction.operands.length,
        terminatorMode: "single"
      });
      validateJitFlagProducerConditionInputUses(instruction.ir);
      validateJitRegisterMaterializations(instruction.ir, instructionIndex, barriers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`${verificationPrefix(options)} invalid JIT IR at instruction ${instructionIndex}: ${message}`);
    }
  }
}

function verifiedJitBarriers(block: JitIrBlock, options: JitOptimizerVerificationOptions): JitBarrierAnalysis {
  try {
    const barriers = analyzeJitBarriers(block);

    validateJitBarrierIndex(block, barriers);
    return barriers;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`${verificationPrefix(options)} invalid JIT barriers: ${message}`);
  }
}

function verificationPrefix(options: JitOptimizerVerificationOptions): string {
  switch (options.phase) {
    case "before-pass":
      return `before JIT optimization pass '${options.passName ?? "<unknown>"}'`;
    case "after-pass":
      return `after JIT optimization pass '${options.passName ?? "<unknown>"}'`;
    case "final":
      return "after final JIT optimization";
  }
}

function jitValidationIrBlock(block: JitIrBody): IrBlock {
  return block.map((op) => {
    if (op.op === "flagProducer.condition") {
      return { op: "aluFlags.condition", dst: op.dst, cc: op.cc };
    }

    return op;
  });
}

function validateJitFlagProducerConditionInputUses(block: JitIrBody): void {
  const definedVars = new Set<number>();

  for (const op of block) {
    if (op.op === "flagProducer.condition") {
      validateJitFlagProducerConditionInputs(op, definedVars);
    }

    const dst = jitIrOpDst(op);

    if (dst !== undefined) {
      definedVars.add(dst.id);
    }
  }
}

function validateJitBarrierIndex(block: JitIrBlock, barriers: JitBarrierAnalysis): void {
  for (const barrier of barriers.barriers) {
    const instruction = block.instructions[barrier.instructionIndex];

    if (instruction === undefined) {
      throw new Error(`barrier references missing instruction ${barrier.instructionIndex}`);
    }

    if (barrier.opIndex !== undefined && instruction.ir[barrier.opIndex] === undefined) {
      throw new Error(`barrier references missing op ${barrier.instructionIndex}:${barrier.opIndex}`);
    }

    if (barrier.reason === "preInstructionExit" && barrier.exitReason === undefined) {
      throw new Error(`pre-instruction exit barrier is missing its exit reason at ${barrier.instructionIndex}:${barrier.opIndex}`);
    }

    if (barrier.reason === "exit" && (barrier.exitReasons?.length ?? 0) === 0) {
      throw new Error(`exit barrier is missing exit reasons at ${barrier.instructionIndex}:${barrier.opIndex}`);
    }
  }
}

function validateJitRegisterMaterializations(
  block: JitIrBody,
  instructionIndex: number,
  barriers: JitBarrierAnalysis
): void {
  for (let opIndex = 0; opIndex < block.length; opIndex += 1) {
    const op = block[opIndex];

    if (op?.op !== "set32" || op.jitRole !== "registerMaterialization") {
      continue;
    }

    if (op.target.kind !== "reg") {
      throw new Error(`JIT register materialization cannot target ${op.target.kind}`);
    }

    const writeBarrier = jitOpBarriersAt(barriers, instructionIndex, opIndex)
      .find((barrier) => barrier.reason === "write");

    if (writeBarrier?.reg !== op.target.reg) {
      throw new Error(`JIT register materialization is missing a write barrier for ${op.target.reg}`);
    }
  }
}

function validateJitFlagProducerConditionInputs(
  op: Extract<JitIrOp, { op: "flagProducer.condition" }>,
  definedVars: ReadonlySet<number>
): void {
  validateJitFlagProducerConditionMasks(op);

  const inputNames = flagProducerConditionInputNames(op);
  const allowedInputs: ReadonlySet<string> = new Set(inputNames);

  for (const inputName of inputNames) {
    validateValueRef(requiredFlagProducerConditionInput(op, inputName), definedVars);
  }

  for (const [inputName, value] of Object.entries(op.inputs)) {
    if (!allowedInputs.has(inputName)) {
      throw new Error(`JIT flag condition ${op.producer}/${op.cc} has unexpected input '${inputName}'`);
    }

    validateValueRef(value, definedVars);
  }
}

function validateJitFlagProducerConditionMasks(op: Extract<JitIrOp, { op: "flagProducer.condition" }>): void {
  const producer = FLAG_PRODUCERS[op.producer];

  assertIrAluFlagMask(op.writtenMask, "flagProducer.condition writtenMask");
  assertIrAluFlagMask(op.undefMask, "flagProducer.condition undefMask");

  if (op.writtenMask !== producer.writtenMask) {
    throw new Error(`JIT flag condition ${op.producer} writtenMask does not match producer metadata`);
  }

  if (op.undefMask !== producer.undefMask) {
    throw new Error(`JIT flag condition ${op.producer} undefMask does not match producer metadata`);
  }

  if ((op.undefMask & ~op.writtenMask) !== 0) {
    throw new Error(`JIT flag condition ${op.producer} undefMask must be contained in writtenMask`);
  }
}

function validateValueRef(value: ValueRef, definedVars: ReadonlySet<number>): void {
  if (value.kind === "var" && !definedVars.has(value.id)) {
    throw new Error(`JIT IR var ${value.id} is used before definition`);
  }
}
