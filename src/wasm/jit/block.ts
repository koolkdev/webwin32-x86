import type { IsaDecodedInstruction } from "../../arch/x86/isa/decoder/types.js";
import { SirProgramSequenceBuilder, type SirProgramSegment } from "../../arch/x86/sir/builder.js";
import type { SirProgram } from "../../arch/x86/sir/types.js";
import { wasmBlockExportName, wasmImport, wasmMemoryIndex } from "../abi.js";
import { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { WasmModuleEncoder } from "../encoder/module.js";
import { wasmValueType } from "../encoder/types.js";
import { jitBindingsFromIsaInstruction, type JitOperandBinding } from "./operand-bindings.js";
import { lowerSirWithJitContext } from "./sir-context.js";
import { createJitSirState, type JitExitTarget, type JitSirState } from "./state.js";

export type JitSirBlockInstruction = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
  opStart: number;
  opEnd: number;
}>;

export type JitSirBlock = Readonly<{
  sir: SirProgram;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitSirBlockInstruction[];
}>;

export function buildJitSirBlock(instructions: readonly IsaDecodedInstruction[]): JitSirBlock {
  if (instructions.length === 0) {
    throw new Error("cannot build empty JIT SIR block");
  }

  const operands: JitOperandBinding[] = [];
  const blockInstructions: JitSirBlockInstruction[] = [];
  const sirBuilder = new SirProgramSequenceBuilder();

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]!;
    const instructionOperands = jitBindingsFromIsaInstruction(instruction);
    const segment = sirBuilder.append(instruction.spec.semantics, {
      operandCount: instructionOperands.length
    });
    const isLastInstruction = index === instructions.length - 1;

    if (!isLastInstruction) {
      assertFallthroughInstruction(segment, instruction);
    }

    operands.push(...instructionOperands);
    blockInstructions.push({
      instructionId: instruction.spec.id,
      eip: instruction.address,
      nextEip: instruction.nextEip,
      nextMode: isLastInstruction ? "exit" : "continue",
      opStart: segment.opStart,
      opEnd: segment.opEnd
    });
  }

  return { sir: sirBuilder.build().program, operands, instructions: blockInstructions };
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
  const state = createJitSirState(body, block.instructions.length);
  const exit: JitExitTarget = { exitLocal, exitLabelDepth: state.maxExitGeneration };

  state.emitEntryLoads();
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

function assertFallthroughInstruction(segment: SirProgramSegment, instruction: IsaDecodedInstruction): void {
  if (segment.terminator !== "next") {
    throw new Error(`non-final JIT SIR block instruction must fall through: ${instruction.spec.id}`);
  }
}
