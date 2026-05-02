import { IrEmitter, irProgramTerminator } from "./emitter.js";
import type { SemanticTemplate, IrProgram } from "#x86/ir/model/types.js";

export {
  const32,
  mem32,
  nextEip,
  operand,
  reg32,
  irVar
} from "#x86/ir/model/refs.js";
export { irProgramTerminator };
export type { IrProgramTerminator } from "./emitter.js";

export function buildIr(template: SemanticTemplate): IrProgram {
  const builder = new IrEmitter();

  template(builder);
  return builder.program();
}
