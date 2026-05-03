import { flagProducerConditionInputNames, requiredFlagProducerConditionInput } from "#x86/ir/model/flag-conditions.js";
import type { IrBlock, ValueRef } from "#x86/ir/model/types.js";
import { validateIrBlock } from "#x86/ir/passes/validator.js";
import { jitIrOpDst } from "#backends/wasm/jit/ir-semantics.js";
import type { JitIrBlock, JitIrBody, JitIrOp } from "#backends/wasm/jit/types.js";

export type JitOptimizerVerificationPhase = "after-pass" | "final";

export type JitOptimizerVerificationOptions = Readonly<{
  phase: JitOptimizerVerificationPhase;
  passName?: string;
}>;

export function verifyJitIrBlock(block: JitIrBlock, options: JitOptimizerVerificationOptions): void {
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
      validateJitFlagConditionInputUses(instruction.ir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`${verificationPrefix(options)} invalid JIT IR at instruction ${instructionIndex}: ${message}`);
    }
  }
}

function verificationPrefix(options: JitOptimizerVerificationOptions): string {
  switch (options.phase) {
    case "after-pass":
      return `after JIT optimization pass '${options.passName ?? "<unknown>"}'`;
    case "final":
      return "after final JIT optimization";
  }
}

function jitValidationIrBlock(block: JitIrBody): IrBlock {
  return block.map((op) => {
    if (op.op === "jit.flagCondition") {
      return { op: "aluFlags.condition", dst: op.dst, cc: op.cc };
    }

    return op;
  });
}

function validateJitFlagConditionInputUses(block: JitIrBody): void {
  const definedVars = new Set<number>();

  for (const op of block) {
    if (op.op === "jit.flagCondition") {
      validateJitFlagConditionInputs(op, definedVars);
    }

    const dst = jitIrOpDst(op);

    if (dst !== undefined) {
      definedVars.add(dst.id);
    }
  }
}

function validateJitFlagConditionInputs(
  op: Extract<JitIrOp, { op: "jit.flagCondition" }>,
  definedVars: ReadonlySet<number>
): void {
  for (const inputName of flagProducerConditionInputNames(op)) {
    validateValueRef(requiredFlagProducerConditionInput(op, inputName), definedVars);
  }
}

function validateValueRef(value: ValueRef, definedVars: ReadonlySet<number>): void {
  if (value.kind === "var" && !definedVars.has(value.id)) {
    throw new Error(`JIT IR var ${value.id} is used before definition`);
  }
}
