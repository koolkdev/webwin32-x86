import type { IsaDecodedInstruction } from "#x86/isa/decoder/types.js";
import { validateIrBlock } from "#x86/ir/passes/validator.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "#backends/wasm/abi.js";
import { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "#backends/wasm/encoder/module.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { JitIrBlockBuilder } from "./lowering/block-builder.js";
import { buildJitLoweringBlock } from "./lowering/lowering-block.js";
import { lowerIrWithJitContext, type JitIrInstructionContext } from "./lowering/ir-context.js";
import { optimizeJitIrBlock, type JitBlockOptimization } from "./optimization/optimize.js";
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
  const loweringBlock = buildJitLoweringBlock(optimization);

  if (block.instructions.length === 0) {
    throw new Error("cannot encode empty JIT IR block");
  }

  validateLoweringBlock(loweringBlock);

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
  lowerIrWithJitContext({
    body,
    scratch,
    state,
    exit,
    instructions: loweringInstructions(loweringBlock, optimization),
    exitPoints: optimization.exitPoints
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

function validateLoweringBlock(block: JitIrBlock): void {
  for (let index = 0; index < block.instructions.length; index += 1) {
    const instruction = block.instructions[index];

    if (instruction === undefined) {
      throw new Error(`missing JIT lowering instruction: ${index}`);
    }

    validateIrBlock(instruction.ir, {
      operandCount: instruction.operands.length,
      terminatorMode: "single"
    });
  }
}

function loweringInstructions(
  block: JitIrBlock,
  optimization: JitBlockOptimization
): readonly JitIrInstructionContext[] {
  if (block.instructions.length !== optimization.instructionStates.length) {
    throw new Error(
      `JIT lowering instruction count mismatch: ${block.instructions.length} !== ${optimization.instructionStates.length}`
    );
  }

  return block.instructions.map((instruction, index) => {
    const state = optimization.instructionStates[index];

    if (state === undefined) {
      throw new Error(`missing JIT instruction state for lowering: ${index}`);
    }

    return {
      ...state,
      ir: instruction.ir,
      operands: instruction.operands
    };
  });
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
