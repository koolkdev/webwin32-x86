import type { IsaDecodedInstruction } from "../../arch/x86/isa/decoder/types.js";
import { buildSir } from "../../arch/x86/sir/builder.js";
import type { SirProgram } from "../../arch/x86/sir/types.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { jitBindingsFromIsaInstruction, type JitOperandBinding } from "./operand-bindings.js";
import { lowerSirWithJitContext } from "./sir-context.js";
import { createJitSirState, type JitSirState } from "./state.js";
import { type WasmSirExitTarget } from "../sir/exit.js";

export type JitSirBlockInstruction = Readonly<{
  instructionId: string;
  sir: SirProgram;
  operands: readonly JitOperandBinding[];
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitSirBlock = Readonly<{
  instructions: readonly JitSirBlockInstruction[];
}>;

export function buildJitSirBlock(instructions: readonly IsaDecodedInstruction[]): JitSirBlock {
  if (instructions.length === 0) {
    throw new Error("cannot build empty JIT SIR block");
  }

  return {
    instructions: instructions.map((instruction, index) => {
      const sir = buildSir(instruction.spec.semantics);
      const isLastInstruction = index === instructions.length - 1;

      if (!isLastInstruction) {
        assertFallthroughInstruction(sir, instruction);
      }

      return {
        instructionId: instruction.spec.id,
        sir,
        operands: jitBindingsFromIsaInstruction(instruction),
        nextEip: instruction.nextEip,
        nextMode: isLastInstruction ? "exit" : "continue"
      };
    })
  };
}

export function encodeJitSirBlock(block: JitSirBlock): Uint8Array<ArrayBuffer> {
  if (block.instructions.length === 0) {
    throw new Error("cannot encode empty JIT SIR block");
  }

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
  const state = createJitSirState(body);
  const exit: WasmSirExitTarget = { exitLocal, exitLabelDepth: 0 };

  state.emitEntryLoads();
  body.block();
  lowerJitSirBlockToWasm(block, { body, scratch, state, exit });
  body.endBlock();
  state.emitExitStores();
  body.localGet(exitLocal).returnFromFunction();
  scratch.assertClear();
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction(wasmBlockExportName, functionIndex);

  return module.encode();
}

function lowerJitSirBlockToWasm(
  block: JitSirBlock,
  context: Readonly<{
    body: WasmFunctionBodyEncoder;
    scratch: WasmLocalScratchAllocator;
    state: JitSirState;
    exit: WasmSirExitTarget;
  }>
): void {
  for (const instruction of block.instructions) {
    lowerSirWithJitContext(instruction.sir, {
      body: context.body,
      scratch: context.scratch,
      state: context.state,
      exit: context.exit,
      operands: instruction.operands,
      nextEip: instruction.nextEip,
      nextMode: instruction.nextMode
    });
  }
}

function assertFallthroughInstruction(program: SirProgram, instruction: IsaDecodedInstruction): void {
  const terminator = program[program.length - 1];

  if (terminator?.op !== "next") {
    throw new Error(`non-final JIT SIR block instruction must fall through: ${instruction.spec.id}`);
  }
}
