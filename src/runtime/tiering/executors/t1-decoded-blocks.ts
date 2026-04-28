import { runResultFromState, StopReason, type RunResult } from "../../../core/execution/run-result.js";
import { u32 } from "../../../core/state/cpu-state.js";
import type { RuntimeTierExecutionContext } from "./context.js";

export function runT1DecodedBlocks(context: RuntimeTierExecutionContext, instructionLimit: number): RunResult {
  let executed = 0;
  let result = runResultFromState(context.state, StopReason.NONE);

  while (executed < instructionLimit) {
    const currentEip = u32(context.state.eip);
    const block = context.decodedBlockCache.getOrDecode(currentEip);
    const blockRun = context.decodedBlockRunner.runBlock(context.state, block, {
      instructionLimit: instructionLimit - executed,
      memory: context.guestMemory
    });

    executed += blockRun.instructionsExecuted;
    result = blockRun.result;

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }

    const nextEip = u32(context.state.eip);
    if (context.decodeReader.regionAt(nextEip) === undefined) {
      return result;
    }

    context.decodedBlockRunner.recordEdge(currentEip, nextEip);
  }

  context.state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(context.state, StopReason.INSTRUCTION_LIMIT);
}
