import type { IsaDecodedInstruction } from "#x86/isa/decoder/types.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "#backends/wasm/abi.js";
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
import { emitJitIrWithContext, type JitIrInstructionContext, type JitLinkResolver } from "./codegen/emit/ir-context.js";
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
  block: JitIrBlock,
  options: EncodeJitIrBlockOptions = {}
): Uint8Array<ArrayBuffer> {
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
  const targetEips = options.linkResolver?.moduleTable.targetEips() ?? [];
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
    ...(options.linkResolver !== undefined && linkTableIndex !== undefined
      ? {
          linking: {
            ...options.linkResolver,
            blockTypeIndex: typeIndex,
            tableIndex: linkTableIndex
          }
        }
      : {})
  });
  emitExitStateStores(body, state, exitLocal);
  scratch.assertClear();
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

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
