import { SirEmitter, type SirProgramTerminator } from "./emitter.js";
import { sirVar } from "./refs.js";
import type {
  OperandRef,
  SemanticTemplate,
  SirOp,
  SirProgram,
  VarRef
} from "./types.js";

export type SirProgramInstruction = Readonly<{
  semantics: SemanticTemplate;
  operands: readonly OperandRef[];
}>;

export type SirProgramAppendResult = Readonly<{
  terminator: SirProgramTerminator;
}>;

export class SirProgramBuilder {
  readonly #ops: SirOp[] = [];
  #nextVarId = 0;

  appendInstruction(instruction: SirProgramInstruction): SirProgramAppendResult {
    const emitter = new SirEmitter({
      ops: this.#ops,
      allocateVar: () => this.#allocVar(),
      resolveOperand: (index) => programOperand(instruction.operands, index)
    });

    instruction.semantics(emitter);
    return { terminator: emitter.finish() };
  }

  build(): SirProgram {
    return [...this.#ops];
  }

  #allocVar(): VarRef {
    const id = this.#nextVarId;

    this.#nextVarId += 1;
    return sirVar(id);
  }
}

function programOperand(operands: readonly OperandRef[], index: number): OperandRef {
  const operandRef = operands[index];

  if (operandRef === undefined) {
    throw new Error(`SIR program operand ${index} is not provided`);
  }

  return operandRef;
}
