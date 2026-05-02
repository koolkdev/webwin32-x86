import type { IsaDecodedInstruction } from "../../../../x86/isa/decoder/types.js";
import { operand } from "../../../../x86/ir/builder.js";
import { IrProgramBuilder } from "../../../../x86/ir/program.js";
import { jitBindingsFromIsaInstruction, type JitOperandBinding } from "./operand-bindings.js";
import { optimizeJitIrBlock } from "./ir-optimization.js";
import type { JitIrBlock, JitIrBlockInstruction } from "../types.js";

export type AppendJitIrInstructionOptions = Readonly<{
  nextMode: "continue" | "exit";
}>;

export class JitIrProgramBuilder {
  readonly #irBuilder = new IrProgramBuilder();
  readonly #operands: JitOperandBinding[] = [];
  readonly #instructions: JitIrBlockInstruction[] = [];

  appendInstruction(
    instruction: IsaDecodedInstruction,
    options: AppendJitIrInstructionOptions
  ): void {
    const instructionOperands = jitBindingsFromIsaInstruction(instruction);
    const operandBase = this.#operands.length;
    const appended = this.#irBuilder.appendInstruction({
      semantics: instruction.spec.semantics,
      operands: instructionOperands.map((_, index) => operand(operandBase + index))
    });

    if (options.nextMode === "continue" && appended.terminator !== "next") {
      throw new Error(`non-final JIT IR block instruction must fall through: ${instruction.spec.id}`);
    }

    this.#operands.push(...instructionOperands);
    this.#instructions.push({
      instructionId: instruction.spec.id,
      eip: instruction.address,
      nextEip: instruction.nextEip,
      nextMode: options.nextMode
    });
  }

  build(): JitIrBlock {
    if (this.#instructions.length === 0) {
      throw new Error("cannot build empty JIT IR block");
    }

    return optimizeJitIrBlock({
      ir: this.#irBuilder.build(),
      operands: [...this.#operands],
      instructions: [...this.#instructions]
    });
  }
}
