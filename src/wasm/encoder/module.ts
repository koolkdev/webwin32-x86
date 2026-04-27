import { ByteSink } from "./byte-sink.js";
import { WasmFunctionBodyEncoder } from "./function-body.js";
import { validateMemoryLimits, type WasmMemoryLimits } from "./memory.js";
import {
  wasmExternalKind,
  wasmFunctionTypePrefix,
  wasmMagic,
  wasmSectionId,
  wasmVersion,
  type WasmFunctionType
} from "./types.js";

export class WasmModuleEncoder {
  readonly #types: WasmFunctionType[] = [];
  readonly #memoryImports: MemoryImport[] = [];
  readonly #functions: number[] = [];
  readonly #exports: FunctionExport[] = [];
  readonly #bodies: Uint8Array<ArrayBuffer>[] = [];

  addFunctionType(type: WasmFunctionType): number {
    const index = this.#types.length;
    this.#types.push(type);
    return index;
  }

  importMemory(moduleName: string, name: string, limits: WasmMemoryLimits): number {
    validateMemoryLimits(limits);

    const memoryIndex = this.#memoryImports.length;
    this.#memoryImports.push({ moduleName, name, limits });
    return memoryIndex;
  }

  addFunction(typeIndex: number, body: WasmFunctionBodyEncoder): number {
    if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= this.#types.length) {
      throw new RangeError(`unknown Wasm function type index: ${typeIndex}`);
    }

    const functionIndex = this.#functions.length;
    this.#functions.push(typeIndex);
    this.#bodies.push(body.encode());
    return functionIndex;
  }

  exportFunction(name: string, functionIndex: number): void {
    if (!Number.isInteger(functionIndex) || functionIndex < 0 || functionIndex >= this.#functions.length) {
      throw new RangeError(`unknown Wasm function index: ${functionIndex}`);
    }

    this.#exports.push({ name, functionIndex });
  }

  encode(): Uint8Array<ArrayBuffer> {
    const module = new ByteSink();

    module.writeBytes(wasmMagic);
    module.writeBytes(wasmVersion);
    module.writeSection(wasmSectionId.type, (section) => this.#writeTypeSection(section));
    if (this.#memoryImports.length > 0) {
      module.writeSection(wasmSectionId.import, (section) => this.#writeImportSection(section));
    }
    module.writeSection(wasmSectionId.function, (section) => this.#writeFunctionSection(section));
    module.writeSection(wasmSectionId.export, (section) => this.#writeExportSection(section));
    module.writeSection(wasmSectionId.code, (section) => this.#writeCodeSection(section));

    return module.toBytes();
  }

  #writeImportSection(section: ByteSink): void {
    section.writeVecLength(this.#memoryImports.length);

    for (const entry of this.#memoryImports) {
      section.writeName(entry.moduleName);
      section.writeName(entry.name);
      section.writeByte(wasmExternalKind.memory);
      writeMemoryType(section, entry.limits);
    }
  }

  #writeTypeSection(section: ByteSink): void {
    section.writeVecLength(this.#types.length);

    for (const type of this.#types) {
      section.writeByte(wasmFunctionTypePrefix);
      section.writeVecLength(type.params.length);
      section.writeBytes(type.params);
      section.writeVecLength(type.results.length);
      section.writeBytes(type.results);
    }
  }

  #writeFunctionSection(section: ByteSink): void {
    section.writeVecLength(this.#functions.length);

    for (const typeIndex of this.#functions) {
      section.writeU32(typeIndex);
    }
  }

  #writeExportSection(section: ByteSink): void {
    section.writeVecLength(this.#exports.length);

    for (const entry of this.#exports) {
      section.writeName(entry.name);
      section.writeByte(wasmExternalKind.function);
      section.writeU32(entry.functionIndex);
    }
  }

  #writeCodeSection(section: ByteSink): void {
    section.writeVecLength(this.#bodies.length);

    for (const body of this.#bodies) {
      section.writeU32(body.byteLength);
      section.writeBytes(body);
    }
  }
}

type MemoryImport = Readonly<{
  moduleName: string;
  name: string;
  limits: WasmMemoryLimits;
}>;

type FunctionExport = Readonly<{
  name: string;
  functionIndex: number;
}>;

function writeMemoryType(section: ByteSink, limits: WasmMemoryLimits): void {
  if (limits.maxPages === undefined) {
    section.writeByte(0x00);
    section.writeU32(limits.minPages);
    return;
  }

  section.writeByte(0x01);
  section.writeU32(limits.minPages);
  section.writeU32(limits.maxPages);
}
