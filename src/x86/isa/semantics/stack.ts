import type { SemanticTemplate, IrBuilder, ValueInput, VarRef } from "../../ir/model/types.js";

export function push32(s: IrBuilder, value: ValueInput): void {
  const esp = s.get32(s.reg32("esp"));
  const nextEsp = s.i32Sub(esp, 4);

  s.set32(s.mem32(nextEsp), value);
  s.set32(s.reg32("esp"), nextEsp);
}

export function pop32(s: IrBuilder): VarRef {
  const esp = s.get32(s.reg32("esp"));
  const value = s.get32(s.mem32(esp));
  const nextEsp = s.i32Add(esp, 4);

  s.set32(s.reg32("esp"), nextEsp);
  return value;
}

export function pushSemantic(): SemanticTemplate {
  return (s) => {
    push32(s, s.get32(s.operand(0)));
  };
}

export function popSemantic(): SemanticTemplate {
  return (s) => {
    s.set32(s.operand(0), pop32(s));
  };
}

export function leaveSemantic(): SemanticTemplate {
  return (s) => {
    const frame = s.get32(s.reg32("ebp"));
    const savedFrame = s.get32(s.mem32(frame));
    const nextEsp = s.i32Add(frame, 4);

    s.set32(s.reg32("esp"), nextEsp);
    s.set32(s.reg32("ebp"), savedFrame);
  };
}
