import type { IsaDecodedInstruction } from "../../arch/x86/isa/decoder/types.js";
import { validateSirProgram } from "../../arch/x86/sir/validator.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { JitSirProgramBuilder } from "./program-builder.js";
import { lowerSirWithJitContext } from "./sir-context.js";
import { createJitSirState, type JitExitTarget, type JitSirState } from "./state.js";
import type { JitSirBlock } from "./types.js";

export type { JitSirBlock, JitSirBlockInstruction } from "./types.js";

export function buildJitSirBlock(instructions: readonly IsaDecodedInstruction[]): JitSirBlock {
  if (instructions.length === 0) {
    throw new Error("cannot build empty JIT SIR block");
  }

  const builder = new JitSirProgramBuilder();

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]!;
    const isLastInstruction = index === instructions.length - 1;

    builder.appendInstruction(instruction, {
      nextMode: isLastInstruction ? "exit" : "continue"
    });
  }

  return builder.build();
}

export function encodeJitSirBlock(block: JitSirBlock): Uint8Array<ArrayBuffer> {
  if (block.instructions.length === 0) {
    throw new Error("cannot encode empty JIT SIR block");
  }

  validateSirProgram(block.sir, {
    operandCount: block.operands.length,
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
  const state = createJitSirState(body, block.instructions.length);
  const exit: JitExitTarget = { exitLocal, exitLabelDepth: state.maxExitGeneration };

  state.emitLoadInstructionCount();

  emitExitGenerationBlocks(body, state.maxExitGeneration);
  lowerSirWithJitContext(block.sir, {
    body,
    scratch,
    state,
    exit,
    operands: block.operands,
    instructions: block.instructions
  });
  emitExitGenerationStores(body, state, exitLocal);
  scratch.assertClear();
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

  return module.encode();
}

function emitExitGenerationBlocks(body: WasmFunctionBodyEncoder, maxExitGeneration: number): void {
  for (let generation = 0; generation <= maxExitGeneration; generation += 1) {
    void generation;
    body.block();
  }
}

function emitExitGenerationStores(
  body: WasmFunctionBodyEncoder,
  state: JitSirState,
  exitLocal: number
): void {
  for (let generation = state.maxExitGeneration; generation >= 0; generation -= 1) {
    body.endBlock();
    state.emitExitStoresForGeneration(generation);
    body.localGet(exitLocal).returnFromFunction();
  }
}
