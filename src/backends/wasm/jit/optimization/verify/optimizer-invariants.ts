import { validateJitIrBlock } from "#backends/wasm/jit/ir/validate.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";

export type JitOptimizerVerificationPhase = "before-pass" | "after-pass" | "final";

export type JitOptimizerVerificationOptions = Readonly<{
  phase: JitOptimizerVerificationPhase;
  passName?: string;
}>;

export function verifyJitIrBlock(block: JitIrBlock, options: JitOptimizerVerificationOptions): void {
  try {
    validateJitIrBlock(block);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`${verificationPrefix(options)} invalid JIT IR: ${message}`);
  }
}

function verificationPrefix(options: JitOptimizerVerificationOptions): string {
  switch (options.phase) {
    case "before-pass":
      return `before JIT optimization pass '${options.passName ?? "<unknown>"}'`;
    case "after-pass":
      return `after JIT optimization pass '${options.passName ?? "<unknown>"}'`;
    case "final":
      return "after final JIT optimization";
  }
}
