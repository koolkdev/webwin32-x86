import type { SemanticTemplate, IrBuilder, ValueInput, VarRef } from "#x86/ir/model/types.js";

export function push32(s: IrBuilder, value: ValueInput): void {
  const esp = s.get(s.reg("esp"));
  const nextEsp = s.i32Sub(esp, 4);

  s.set(s.mem(nextEsp), value);
  s.set(s.reg("esp"), nextEsp);
}

export function pop32(s: IrBuilder): VarRef {
  const esp = s.get(s.reg("esp"));
  const value = s.get(s.mem(esp));
  const nextEsp = s.i32Add(esp, 4);

  s.set(s.reg("esp"), nextEsp);
  return value;
}

export function pushSemantic(): SemanticTemplate {
  return (s) => {
    push32(s, s.get(s.operand(0)));
  };
}

export function popSemantic(): SemanticTemplate {
  return (s) => {
    s.set(s.operand(0), pop32(s));
  };
}

export function leaveSemantic(): SemanticTemplate {
  return (s) => {
    const frame = s.get(s.reg("ebp"));
    const savedFrame = s.get(s.mem(frame));
    const nextEsp = s.i32Add(frame, 4);

    s.set(s.reg("esp"), nextEsp);
    s.set(s.reg("ebp"), savedFrame);
  };
}
