import { decodeIsaBlock, type IsaDecodedBlock } from "../../../../x86/isa/decoder/decode-block.js";
import type { IsaDecodeFault } from "../../../../x86/isa/decoder/reader.js";
import { u32 } from "../../../../x86/state/cpu-state.js";
import { UnsupportedWasmCodegenError } from "../../errors.js";
import { compileWasmBlockHandle } from "../block-handle.js";
import type { WasmHostMemories } from "../../host/memories.js";
import type { CompiledBlockCache, CompiledBlockHandle, WasmCompiledBlockCodeMap } from "./block-cache.js";

export type WasmCompiledBlockCacheLike = CompiledBlockCache & Partial<Readonly<{
  clear(): void;
}>>;

export class CompiledBlockDecodeError extends Error {
  constructor(readonly fault: IsaDecodeFault) {
    super(`failed to decode compiled block at 0x${fault.address.toString(16)}`);
    this.name = "CompiledBlockDecodeError";
  }
}

export class WasmCompiledBlockCache implements WasmCompiledBlockCacheLike {
  readonly #blocksByEip = new Map<number, CompiledBlockHandle>();

  clear(): void {
    this.#blocksByEip.clear();
  }

  getOrCompile(startEip: number, codeMap: WasmCompiledBlockCodeMap, memories: WasmHostMemories): CompiledBlockHandle | undefined {
    const blockKey = u32(startEip);
    const cached = this.#blocksByEip.get(blockKey);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const block = decodeIsaBlock(codeMap.createReader(memories.guest), blockKey, { maxInstructions: 1024 });

      assertCompiledBlockDecodable(block);

      if (block.instructions.length === 0) {
        return undefined;
      }

      const compiled = compileWasmBlockHandle(block, {
        stateMemory: memories.stateMemory,
        guestMemory: memories.guestMemory,
        blockKey
      });

      this.#blocksByEip.set(blockKey, compiled);
      return compiled;
    } catch (error: unknown) {
      if (error instanceof UnsupportedWasmCodegenError) {
        return undefined;
      }

      throw error;
    }
  }
}

function assertCompiledBlockDecodable(block: IsaDecodedBlock): void {
  if (block.terminator.kind === "decode-fault") {
    throw new CompiledBlockDecodeError(block.terminator.fault);
  }
}
