import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { indexJitEffects, type JitEffectIndex } from "./effects.js";

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
