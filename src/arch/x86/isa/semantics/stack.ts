import type { SemanticTemplate, SirBuilder, ValueInput, VarRef } from "../../sir/types.js";

export function push32(s: SirBuilder, value: ValueInput): void {
  const esp = s.get32(s.reg32("esp"));
  const nextEsp = s.i32Sub(esp, 4);

  s.set32(s.reg32("esp"), nextEsp);
  s.set32(s.mem32(nextEsp), value);
}

export function pop32(s: SirBuilder): VarRef {
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
