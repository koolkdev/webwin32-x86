import type { IsaDecodedInstruction } from "#x86/isa/decoder/types.js";
import { operand } from "#x86/ir/build/builder.js";
import { IrProgramBuilder } from "#x86/ir/build/program.js";
import { jitBindingsFromIsaInstruction, type JitOperandBinding } from "./operand-bindings.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";

export type AppendJitIrInstructionOptions = Readonly<{
  nextMode: "continue" | "exit";
}>;

export class JitIrProgramBuilder {
  readonly #instructions: JitIrBlockInstruction[] = [];

  appendInstruction(
    instruction: IsaDecodedInstruction,
    options: AppendJitIrInstructionOptions
  ): void {
    const instructionOperands = jitBindingsFromIsaInstruction(instruction);
    const irBuilder = new IrProgramBuilder();
    const appended = irBuilder.appendInstruction({
      semantics: instruction.spec.semantics,
      operands: instructionOperands.map((_, index) => operand(index))
    });

    if (options.nextMode === "continue" && appended.terminator !== "next") {
      throw new Error(`non-final JIT IR block instruction must fall through: ${instruction.spec.id}`);
    }

    this.#instructions.push({
      instructionId: instruction.spec.id,
      eip: instruction.address,
      nextEip: instruction.nextEip,
      nextMode: options.nextMode,
      operands: instructionOperands,
      ir: irBuilder.build()
    });
  }

  build(): JitIrBlock {
    if (this.#instructions.length === 0) {
      throw new Error("cannot build empty JIT IR block");
    }

    return {
      instructions: [...this.#instructions]
    };
  }
}
