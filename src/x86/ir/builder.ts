import { IrEmitter, irProgramTerminator } from "./emitter.js";
import type { SemanticTemplate, IrProgram } from "./types.js";

export {
  const32,
  mem32,
  nextEip,
  operand,
  reg32,
  irVar
} from "./refs.js";
export { irProgramTerminator };
export type { IrProgramTerminator } from "./emitter.js";

export function buildIr(template: SemanticTemplate): IrProgram {
  const builder = new IrEmitter();

  template(builder);
  return builder.program();
}
