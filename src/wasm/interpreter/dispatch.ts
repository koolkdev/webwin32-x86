import { X86_32_CORE } from "../../arch/x86/isa/index.js";
import { buildOpcodeDispatch, type OpcodeDispatchNode } from "../../arch/x86/isa/decoder/opcode-dispatch.js";
import { expandInstructionSpec } from "../../arch/x86/isa/schema/builders.js";

export const interpreterOpcodeDispatchRoot: OpcodeDispatchNode = buildOpcodeDispatch(
  X86_32_CORE.instructions.flatMap((spec) => expandInstructionSpec(spec))
);

export function dispatchBytes(node: OpcodeDispatchNode): number[] {
  const bytes: number[] = [];

  for (let byte = 0; byte <= 0xff; byte += 1) {
    if (node.next[byte] !== undefined) {
      bytes.push(byte);
    }
  }

  return bytes;
}
