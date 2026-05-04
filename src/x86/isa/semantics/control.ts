import type { ConditionCode, SemanticTemplate } from "#x86/ir/model/types.js";
import { pop32, push32 } from "./stack.js";

export function jmpSemantic(): SemanticTemplate {
  return (s) => {
    s.jump(s.get(s.operand(0)));
  };
}

export function callSemantic(): SemanticTemplate {
  return (s) => {
    const target = s.get(s.operand(0));

    push32(s, s.nextEip());
    s.jump(target);
  };
}

export function retSemantic(): SemanticTemplate {
  return (s) => {
    s.jump(pop32(s));
  };
}

export function retImmSemantic(): SemanticTemplate {
  return (s) => {
    const target = pop32(s);
    const bytes = s.get(s.operand(0));
    const esp = s.get(s.reg("esp"));
    const adjustedEsp = s.i32Add(esp, bytes);

    s.set(s.reg("esp"), adjustedEsp);
    s.jump(target);
  };
}

export function jccSemantic(cc: ConditionCode): SemanticTemplate {
  return (s) => {
    s.conditionalJump(s.condition(cc), s.get(s.operand(0)), s.nextEip());
  };
}
