import type { IsaDecodedInstruction } from "#x86/isa/decoder/types.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "#backends/wasm/abi.js";
import { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "#backends/wasm/encoder/module.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { validateJitIrBlock } from "./ir/validate.js";
import { JitIrBlockBuilder } from "./codegen/emit/block-builder.js";
import { buildJitCodegenIr } from "./codegen/plan/block.js";
import { planJitCodegen } from "./codegen/plan/plan.js";
import { emitJitIrWithContext, type JitIrInstructionContext } from "./codegen/emit/ir-context.js";
import { optimizeJitIrBlock } from "./optimization/optimize.js";
import type { JitCodegenPlan } from "#backends/wasm/jit/codegen/plan/types.js";
import { createJitIrState, type JitExitTarget, type JitIrState } from "./state/state.js";
import type { JitIrBlock } from "./ir/types.js";

export type {
  JitIrBlock,
  JitIrBlockInstruction
} from "./types.js";

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
  const optimizedBlock = optimizeJitIrBlock(block);
  const codegenPlan = planJitCodegen(optimizedBlock);
  const codegenIr = buildJitCodegenIr(codegenPlan);

  if (block.instructions.length === 0) {
    throw new Error("cannot encode empty JIT IR block");
  }

  validateJitIrBlock(codegenIr);

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
  const state = createJitIrState(body, codegenPlan.exitStates);
  const exit: JitExitTarget = { exitLocal, exitLabelDepth: state.maxExitStateIndex };

  state.emitLoadInstructionCount();

  emitExitStateBlocks(body, state.maxExitStateIndex);
  emitJitIrWithContext({
    body,
    scratch,
    state,
    exit,
    instructions: codegenInstructions(codegenIr, codegenPlan),
    exitPoints: codegenPlan.exitPoints
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

function codegenInstructions(
  block: JitIrBlock,
  codegenPlan: JitCodegenPlan
): readonly JitIrInstructionContext[] {
  if (block.instructions.length !== codegenPlan.instructionStates.length) {
    throw new Error(
      `JIT codegen instruction count mismatch: ${block.instructions.length} !== ${codegenPlan.instructionStates.length}`
    );
  }

  return block.instructions.map((instruction, index) => {
    const state = codegenPlan.instructionStates[index];

    if (state === undefined) {
      throw new Error(`missing JIT instruction state for codegen: ${index}`);
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
