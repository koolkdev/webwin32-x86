export class InterpreterDispatchDepths {
  constructor(
    readonly instructionDone: number,
    readonly opcode: number,
    readonly prefixLoop: number | undefined = undefined
  ) {}

  static root(): InterpreterDispatchDepths {
    return new InterpreterDispatchDepths(0, 0);
  }

  caseBranch(index: number): InterpreterDispatchDepths {
    const delta = 1 + index;

    return new InterpreterDispatchDepths(
      this.instructionDone + delta,
      this.opcode,
      this.prefixLoop === undefined ? undefined : this.prefixLoop + delta
    );
  }

  opcodeChild(): InterpreterDispatchDepths {
    return new InterpreterDispatchDepths(this.instructionDone, this.opcode + 1, this.prefixLoop);
  }

  opcodeRoot(): InterpreterDispatchDepths {
    return new InterpreterDispatchDepths(this.instructionDone, 0, this.prefixLoop);
  }

  prefixLoopBody(): InterpreterDispatchDepths {
    return new InterpreterDispatchDepths(this.instructionDone + 1, 0, 0);
  }
}
