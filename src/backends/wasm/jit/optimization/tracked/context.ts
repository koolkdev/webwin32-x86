import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { indexJitEffects, type JitEffectIndex } from "#backends/wasm/jit/optimization/effects/effects.js";

export type JitOptimizationContext = Readonly<{
  block: JitIrBlock;
  effects: JitEffectIndex;
}>;

export function createJitOptimizationContext(block: JitIrBlock): JitOptimizationContext {
  return {
    block,
    effects: indexJitEffects(block)
  };
}
