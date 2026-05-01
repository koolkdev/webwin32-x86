import { SirEmitter, sirProgramTerminator } from "./emitter.js";
import type { SemanticTemplate, SirProgram } from "./types.js";

export {
  const32,
  mem32,
  nextEip,
  operand,
  reg32,
  sirVar
} from "./refs.js";
export { sirProgramTerminator };
export type { SirProgramTerminator } from "./emitter.js";

export function buildSir(template: SemanticTemplate): SirProgram {
  const builder = new SirEmitter();

  template(builder);
  return builder.program();
}
