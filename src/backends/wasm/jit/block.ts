import type { IsaDecodedInstruction } from "#x86/isa/decoder/types.js";
import { validateIrBlock } from "#x86/ir/passes/validator.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "#backends/wasm/abi.js";
import { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "#backends/wasm/encoder/module.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { JitIrBlockBuilder } from "./lowering/block-builder.js";
import { prepareJitIrBlockForLowering } from "./lowering/ir-optimization.js";
import { lowerIrWithJitContext } from "./lowering/ir-context.js";
import { optimizeJitIrBlock } from "./optimization/optimize.js";
import { createJitIrState, type JitExitTarget, type JitIrState } from "./state/state.js";
import type { JitIrBlock } from "./types.js";

export type { JitIrBlock, JitIrBlockInstruction } from "./types.js";

export function buildJitIrBlock(instructions: readonly IsaDecodedInstruction[]): JitIrBlock {
  if (instructions.length === 0) {
    throw new Error("cannot build empty JIT IR block");
  }

  const builder = new JitIrBlockBuilder();

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]!;
    const isLastInstruction = index === instructions.length - 1;

    builder.appendInstruction(instruction, {
      nextMode: isLastInstruction ? "exit" : "continue"
    });
  }

  return builder.build();
}

export function encodeJitIrBlock(block: JitIrBlock): Uint8Array<ArrayBuffer> {
  const optimization = optimizeJitIrBlock(block);
  const loweringBlock = prepareJitIrBlockForLowering(block, optimization);

  if (block.instructions.length === 0) {
    throw new Error("cannot encode empty JIT IR block");
  }

  validateIrBlock(loweringBlock.ir, {
    operandCount: loweringBlock.operands.length,
    terminatorMode: "multi"
  });

  const module = new WasmModuleEncoder();
  const stateMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.stateMemoryName, { minPages: 1 });
  const guestMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.guestMemoryName, { minPages: 1 });

  if (stateMemoryIndex !== wasmMemoryIndex.state || guestMemoryIndex !== wasmMemoryIndex.guest) {
    throw new Error("unexpected Wasm memory import order");
  }

  const typeIndex = module.addFunctionType({
    params: [],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder();
  const scratch = new WasmLocalScratchAllocator(body);
  const exitLocal = body.addLocal(wasmValueType.i64);
  const state = createJitIrState(body, optimization.exitStates);
  const exit: JitExitTarget = { exitLocal, exitLabelDepth: state.maxExitStateIndex };

  state.emitLoadInstructionCount();

  emitExitStateBlocks(body, state.maxExitStateIndex);
  lowerIrWithJitContext(loweringBlock.ir, {
    body,
    scratch,
    state,
    exit,
    operands: loweringBlock.operands,
    instructions: optimization.instructionStates
  });
  emitExitStateStores(body, state, exitLocal);
  scratch.assertClear();
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

  return module.encode();
}

function emitExitStateBlocks(body: WasmFunctionBodyEncoder, maxExitStateIndex: number): void {
  for (let index = 0; index <= maxExitStateIndex; index += 1) {
    void index;
    body.block();
  }
}

function emitExitStateStores(
  body: WasmFunctionBodyEncoder,
  state: JitIrState,
  exitLocal: number
): void {
  for (let index = state.maxExitStateIndex; index >= 0; index -= 1) {
    body.endBlock();
    state.emitExitStateStores(index);
    body.localGet(exitLocal).returnFromFunction();
  }
}
