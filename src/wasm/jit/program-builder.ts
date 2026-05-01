import type { IsaDecodedInstruction } from "../../arch/x86/isa/decoder/types.js";
import { operand } from "../../arch/x86/sir/builder.js";
import { SirProgramBuilder } from "../../arch/x86/sir/program.js";
import { jitBindingsFromIsaInstruction, type JitOperandBinding } from "./operand-bindings.js";
import { optimizeJitSirBlock } from "./sir-optimization.js";
import type { JitSirBlock, JitSirBlockInstruction } from "./types.js";

export type AppendJitSirInstructionOptions = Readonly<{
  nextMode: "continue" | "exit";
}>;

export class JitSirProgramBuilder {
  readonly #sirBuilder = new SirProgramBuilder();
  readonly #operands: JitOperandBinding[] = [];
  readonly #instructions: JitSirBlockInstruction[] = [];

  appendInstruction(
    instruction: IsaDecodedInstruction,
    options: AppendJitSirInstructionOptions
  ): void {
    const instructionOperands = jitBindingsFromIsaInstruction(instruction);
    const operandBase = this.#operands.length;
    const appended = this.#sirBuilder.appendInstruction({
      semantics: instruction.spec.semantics,
      operands: instructionOperands.map((_, index) => operand(operandBase + index))
    });

    if (options.nextMode === "continue" && appended.terminator !== "next") {
      throw new Error(`non-final JIT SIR block instruction must fall through: ${instruction.spec.id}`);
    }

    this.#operands.push(...instructionOperands);
    this.#instructions.push({
      instructionId: instruction.spec.id,
      eip: instruction.address,
      nextEip: instruction.nextEip,
      nextMode: options.nextMode
    });
  }

  build(): JitSirBlock {
    if (this.#instructions.length === 0) {
      throw new Error("cannot build empty JIT SIR block");
    }

    return optimizeJitSirBlock({
      sir: this.#sirBuilder.build(),
      operands: [...this.#operands],
      instructions: [...this.#instructions]
    });
  }
}
