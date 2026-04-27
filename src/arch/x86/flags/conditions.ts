import type { JccCondition } from "../instruction/condition.js";

export type JccFlags = Readonly<{
  CF: boolean;
  PF: boolean;
  ZF: boolean;
  SF: boolean;
  OF: boolean;
}>;

export function isJccConditionMet(condition: JccCondition, flags: JccFlags): boolean {
  switch (condition) {
    case "jo":
      return flags.OF;
    case "jno":
      return !flags.OF;
    case "jb":
      return flags.CF;
    case "jae":
      return !flags.CF;
    case "jz":
      return flags.ZF;
    case "jnz":
      return !flags.ZF;
    case "jbe":
      return flags.CF || flags.ZF;
    case "ja":
      return !flags.CF && !flags.ZF;
    case "js":
      return flags.SF;
    case "jns":
      return !flags.SF;
    case "jp":
      return flags.PF;
    case "jnp":
      return !flags.PF;
    case "jl":
      return flags.SF !== flags.OF;
    case "jge":
      return flags.SF === flags.OF;
    case "jle":
      return flags.ZF || flags.SF !== flags.OF;
    case "jg":
      return !flags.ZF && flags.SF === flags.OF;
  }
}
