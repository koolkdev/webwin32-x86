import { runResultFromState, StopReason, type RunResult } from "../../../core/execution/run-result.js";
import { u32 } from "../../../core/state/cpu-state.js";
import type { RuntimeTierExecutionContext } from "./context.js";
import type { DecodedBlock } from "../../../arch/x86/block-decoder/decode-block.js";

export type T1DecodedBlockStep = Readonly<{
  kind: "done";
  result: RunResult;
  instructionsExecuted: number;
}> | Readonly<{
  kind: "continue";
  result: RunResult;
  instructionsExecuted: number;
  nextEip: number;
}>;

export function runT1DecodedBlocks(context: RuntimeTierExecutionContext, instructionLimit: number): RunResult {
  let executed = 0;
  let result = runResultFromState(context.state, StopReason.NONE);

  while (executed < instructionLimit) {
    const currentEip = u32(context.state.eip);
    const block = context.decodedBlockCache.getOrDecode(currentEip);
    const blockStep = runT1DecodedBlockStep(context, currentEip, block, instructionLimit - executed);

    executed += blockStep.instructionsExecuted;
    result = blockStep.result;

    if (blockStep.kind === "done") {
      return result;
    }
  }

  context.state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(context.state, StopReason.INSTRUCTION_LIMIT);
}

export function runT1DecodedBlockStep(
  context: RuntimeTierExecutionContext,
  currentEip: number,
  block: DecodedBlock,
  instructionLimit: number
): T1DecodedBlockStep {
  const blockRun = context.decodedBlockRunner.runBlock(context.state, block, {
    instructionLimit,
    memory: context.guestMemory
  });

  if (blockRun.result.stopReason !== StopReason.NONE) {
    return doneStep(blockRun.result, blockRun.instructionsExecuted);
  }

  const nextEip = u32(context.state.eip);

  if (context.decodeReader.regionAt(nextEip) === undefined) {
    return doneStep(blockRun.result, blockRun.instructionsExecuted);
  }

  context.decodedBlockRunner.recordEdge(currentEip, nextEip);

  return {
    kind: "continue",
    result: blockRun.result,
    instructionsExecuted: blockRun.instructionsExecuted,
    nextEip
  };
}

function doneStep(result: RunResult, instructionsExecuted: number): T1DecodedBlockStep {
  return { kind: "done", result, instructionsExecuted };
}
