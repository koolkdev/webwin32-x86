import { IrEmitter, irBlockTerminator } from "./emitter.js";
import type { SemanticTemplate, IrBlock } from "#x86/ir/model/types.js";

export {
  const32,
  mem32,
  nextEip,
  operand,
  reg32,
  irVar
} from "#x86/ir/model/refs.js";
export { irBlockTerminator };
export type { IrBlockTerminator } from "./emitter.js";

export function buildIr(template: SemanticTemplate): IrBlock {
  const builder = new IrEmitter();

  template(builder);
  return builder.block();
}
