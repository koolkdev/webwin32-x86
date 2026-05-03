import type { JitOperandBinding } from "#backends/wasm/jit/lowering/operand-bindings.js";

export function requiredJitOperandBinding(
  operands: readonly JitOperandBinding[],
  index: number
): JitOperandBinding {
  const operand = operands[index];

  if (operand === undefined) {
    throw new Error(`missing JIT operand while analyzing JIT IR block: ${index}`);
  }

  return operand;
}
