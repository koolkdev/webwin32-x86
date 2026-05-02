import { IrEmitter, type IrProgramTerminator } from "./emitter.js";
import { irVar } from "../model/refs.js";
import type {
  OperandRef,
  SemanticTemplate,
  IrOp,
  IrProgram,
  VarRef
} from "../model/types.js";

export type IrProgramInstruction = Readonly<{
  semantics: SemanticTemplate;
  operands: readonly OperandRef[];
}>;

export type IrProgramAppendResult = Readonly<{
  terminator: IrProgramTerminator;
}>;

export class IrProgramBuilder {
  readonly #ops: IrOp[] = [];
  #nextVarId = 0;

  appendInstruction(instruction: IrProgramInstruction): IrProgramAppendResult {
    const emitter = new IrEmitter({
      ops: this.#ops,
      allocateVar: () => this.#allocVar(),
      resolveOperand: (index) => programOperand(instruction.operands, index)
    });

    instruction.semantics(emitter);
    return { terminator: emitter.finish() };
  }

  build(): IrProgram {
    return [...this.#ops];
  }

  #allocVar(): VarRef {
    const id = this.#nextVarId;

    this.#nextVarId += 1;
    return irVar(id);
  }
}

function programOperand(operands: readonly OperandRef[], index: number): OperandRef {
  const operandRef = operands[index];

  if (operandRef === undefined) {
    throw new Error(`IR program operand ${index} is not provided`);
  }

  return operandRef;
}
