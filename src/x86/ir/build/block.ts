import { IrEmitter, type IrBlockTerminator } from "./emitter.js";
import { irVar } from "#x86/ir/model/refs.js";
import type {
  OperandRef,
  SemanticTemplate,
  IrOp,
  IrBlock,
  VarRef
} from "#x86/ir/model/types.js";

export type IrBlockInstruction = Readonly<{
  semantics: SemanticTemplate;
  operands: readonly OperandRef[];
}>;

export type IrBlockAppendResult = Readonly<{
  terminator: IrBlockTerminator;
}>;

export class IrBlockBuilder {
  readonly #ops: IrOp[] = [];
  #nextVarId = 0;

  appendInstruction(instruction: IrBlockInstruction): IrBlockAppendResult {
    const emitter = new IrEmitter({
      ops: this.#ops,
      allocateVar: () => this.#allocVar(),
      resolveOperand: (index) => blockOperand(instruction.operands, index)
    });

    instruction.semantics(emitter);
    return { terminator: emitter.finish() };
  }

  build(): IrBlock {
    return [...this.#ops];
  }

  #allocVar(): VarRef {
    const id = this.#nextVarId;

    this.#nextVarId += 1;
    return irVar(id);
  }
}

function blockOperand(operands: readonly OperandRef[], index: number): OperandRef {
  const operandRef = operands[index];

  if (operandRef === undefined) {
    throw new Error(`IR block operand ${index} is not provided`);
  }

  return operandRef;
}
