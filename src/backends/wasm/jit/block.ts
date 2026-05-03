import type { IsaDecodedInstruction } from "#x86/isa/decoder/types.js";
import { u32 } from "#x86/state/cpu-state.js";
import { wasmImport, wasmMemoryIndex } from "#backends/wasm/abi.js";
import { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "#backends/wasm/encoder/module.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { encodeExit, ExitReason } from "#backends/wasm/exit.js";
import { jitModuleLinkFallbackExportName } from "./compiled-blocks/module-link-table.js";
import { validateJitIrBlock } from "./ir/validate.js";
import { JitIrBlockBuilder } from "./codegen/emit/block-builder.js";
import { buildJitCodegenIr } from "./codegen/plan/block.js";
import { planJitCodegen } from "./codegen/plan/plan.js";
import {
  emitJitIrWithContext,
  type JitIrInstructionContext,
  type JitLinkEmitContext,
  type JitLinkResolver
} from "./codegen/emit/ir-context.js";
import { optimizeJitIrBlock } from "./optimization/optimize.js";
import type { JitCodegenPlan } from "#backends/wasm/jit/codegen/plan/types.js";
import { createJitIrState, type JitExitTarget, type JitIrState } from "./state/state.js";
import type { JitIrBlock } from "./ir/types.js";

export type {
  JitIrBlock,
  JitIrBlockInstruction
} from "./types.js";
export type { JitLinkResolver } from "./codegen/emit/ir-context.js";

export type EncodeJitIrBlockOptions = Readonly<{
  linkResolver?: JitLinkResolver;
}>;

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

export function encodeJitIrBlock(
  blocks: readonly JitIrBlock[],
  options: EncodeJitIrBlockOptions = {}
): Uint8Array<ArrayBuffer> {
  if (blocks.length === 0) {
    throw new Error("cannot encode empty JIT IR block module");
  }

  const entries = blocks.map((block) => ({
    block,
    entryEip: entryEipForBlock(block)
  }));
  const targetEips = options.linkResolver?.moduleTable?.targetEips() ?? [];
  const blockFunctionIndices = blockFunctionIndicesForEntries(entries, targetEips);
  const module = new WasmModuleEncoder();
  const stateMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.stateMemoryName, { minPages: 1 });
  const guestMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.guestMemoryName, { minPages: 1 });
  const linkTableIndex = targetEips.length === 0
    ? undefined
    : module.importTable(wasmImport.moduleName, wasmImport.linkTableName, {
        minElements: targetEips.length,
        maxElements: targetEips.length
      });

  if (stateMemoryIndex !== wasmMemoryIndex.state || guestMemoryIndex !== wasmMemoryIndex.guest) {
    throw new Error("unexpected Wasm memory import order");
  }

  const typeIndex = module.addFunctionType({
    params: [],
    results: [wasmValueType.i64]
  });
  emitLinkFallbackExports(module, typeIndex, targetEips);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry === undefined) {
      throw new Error(`missing JIT block module entry: ${index}`);
    }

    const expectedFunctionIndex = blockFunctionIndices.get(entry.entryEip);

    if (expectedFunctionIndex === undefined) {
      throw new Error(`missing function index for JIT block 0x${entry.entryEip.toString(16)}`);
    }

    const body = encodeJitIrBlockFunctionBody(
      entry.block,
      linkingContext(
        {
          ...(options.linkResolver === undefined ? {} : options.linkResolver),
          functionIndexForStaticTarget: (eip) => blockFunctionIndices.get(u32(eip))
        },
        typeIndex,
        linkTableIndex
      )
    );
    const functionIndex = module.addFunction(typeIndex, body);

    if (functionIndex !== expectedFunctionIndex) {
      throw new Error(`unexpected JIT block function index: ${functionIndex} !== ${expectedFunctionIndex}`);
    }

    module.exportFunction(jitBlockExportName(entry.entryEip), functionIndex);
  }

  return module.encode();
}

export function staticJitLinkTargets(block: JitIrBlock): readonly number[] {
  const instruction = block.instructions[block.instructions.length - 1];

  if (
    instruction === undefined ||
    instruction.nextMode !== "exit" ||
    (instruction.instructionId !== "jmp.rel8" && instruction.instructionId !== "jmp.rel32")
  ) {
    return [];
  }

  const target = instruction.operands[0];

  return target?.kind === "static.relTarget" ? [target.target] : [];
}

export function jitBlockExportName(eip: number): string {
  return `block_${u32(eip).toString(16)}`;
}

function encodeJitIrBlockFunctionBody(
  block: JitIrBlock,
  linking?: JitLinkEmitContext
): WasmFunctionBodyEncoder {
  const optimizedBlock = optimizeJitIrBlock(block);
  const codegenPlan = planJitCodegen(optimizedBlock);
  const codegenIr = buildJitCodegenIr(codegenPlan);

  validateJitIrBlock(codegenIr);

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
    exitPoints: codegenPlan.exitPoints,
    ...(linking === undefined ? {} : { linking })
  });
  emitExitStateStores(body, state, exitLocal);
  scratch.assertClear();
  body.end();

  return body;
}

function linkingContext(
  resolver: JitLinkResolver | undefined,
  blockTypeIndex: number,
  tableIndex: number | undefined
): JitLinkEmitContext | undefined {
  if (resolver === undefined) {
    return undefined;
  }

  if (
    resolver.functionIndexForStaticTarget === undefined &&
    (resolver.slotForStaticTarget === undefined || tableIndex === undefined)
  ) {
    return undefined;
  }

  return {
    ...resolver,
    blockTypeIndex,
    ...(tableIndex === undefined ? {} : { tableIndex })
  };
}

type JitBlockModuleEntry = Readonly<{
  block: JitIrBlock;
  entryEip: number;
}>;

function entryEipForBlock(block: JitIrBlock): number {
  const instruction = block.instructions[0];

  if (instruction === undefined) {
    throw new Error("cannot encode empty JIT IR block in module");
  }

  return u32(instruction.eip);
}

function blockFunctionIndicesForEntries(
  entries: readonly JitBlockModuleEntry[],
  fallbackTargetEips: readonly number[]
): ReadonlyMap<number, number> {
  const indices = new Map<number, number>();
  let nextFunctionIndex = fallbackTargetEips.length;

  for (const entry of entries) {
    const entryEip = u32(entry.entryEip);

    if (indices.has(entryEip)) {
      throw new Error(`duplicate JIT block module entry EIP: 0x${entryEip.toString(16)}`);
    }

    indices.set(entryEip, nextFunctionIndex);
    nextFunctionIndex += 1;
  }

  return indices;
}

function emitExitStateBlocks(body: WasmFunctionBodyEncoder, maxExitStateIndex: number): void {
  for (let index = 0; index <= maxExitStateIndex; index += 1) {
    void index;
    body.block();
  }
}

function emitLinkFallbackExports(
  module: WasmModuleEncoder,
  typeIndex: number,
  targetEips: readonly number[]
): void {
  for (const targetEip of targetEips) {
    const fallbackIndex = module.addFunction(
      typeIndex,
      new WasmFunctionBodyEncoder()
        .i64Const(encodeExit(ExitReason.JUMP, targetEip))
        .end()
    );

    module.exportFunction(jitModuleLinkFallbackExportName(targetEip), fallbackIndex);
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
