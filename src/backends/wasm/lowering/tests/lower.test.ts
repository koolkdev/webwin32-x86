import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { Reg32 } from "#x86/isa/types.js";
import { buildIr } from "#x86/ir/build/builder.js";
import type { IrExpressionOptions, IrStorageExpr, IrValueExpr } from "#x86/ir/model/expressions.js";
import type { IrBlock } from "#x86/ir/model/types.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import { WasmModuleEncoder } from "#backends/wasm/encoder/module.js";
import { wasmOpcode, wasmValueType, type WasmValueType } from "#backends/wasm/encoder/types.js";
import { lowerIrToWasm, type WasmIrEmitHelpers } from "#backends/wasm/lowering/lower.js";
import { wasmBodyOpcodes } from "#backends/wasm/tests/body-opcodes.js";

const nextEipValue = 0x1234_5678;

test("lowerIrToWasm lowers arithmetic through storage callbacks", async () => {
  const run = await instantiateLoweredBinary(
    buildIr((s) => {
      const left = s.get32(s.operand(0));
      const right = s.get32(s.operand(1));
      const adjusted = s.i32Add(left, 9);

      s.set32(s.reg32("eax"), s.i32Or(s.i32Xor(adjusted, right), 0x80));
    })
  );

  strictEqual(run(0x10, 0x20), 0xb9);
  strictEqual(run(0, 0), 0x89);
});

test("lowerIrToWasm lowers conditional control values with nested emitValue", async () => {
  const run = await instantiateLoweredBinary(
    buildIr((s) => {
      const left = s.get32(s.operand(0));
      const right = s.get32(s.operand(1));
      const sum = s.i32Add(left, right);

      s.conditionalJump(s.i32And(sum, 1), sum, s.nextEip());
    })
  );

  strictEqual(run(1, 2), 3);
  strictEqual(run(2, 2), nextEipValue);
});

test("lowerIrToWasm lowers set32.if as a conditional write", async () => {
  const program = buildIr((s) => {
    const value = s.get32(s.operand(0));
    const condition = s.get32(s.operand(1));

    s.set32(s.reg32("eax"), 0x55);
    s.set32If(condition, s.reg32("eax"), value);
  });
  const run = await instantiateLoweredBinary(program);
  const opcodes = loweredBodyOpcodes(program);

  strictEqual(run(0x33, 1), 0x33);
  strictEqual(run(0x33, 0), 0x55);
  strictEqual(opcodes.includes(wasmOpcode.if), true);
});

test("lowerIrToWasm uses planned slots for non-overlapping IR locals", () => {
  const scratch = lowerWithTrackingScratch(
    buildIr((s) => {
      const first = s.get32(s.operand(0));

      s.set32(s.reg32("eax"), first);

      const second = s.get32(s.operand(1));

      s.set32(s.reg32("ebx"), second);
      s.next();
    }),
    { canInlineGet32: () => false }
  );

  strictEqual(scratch.maxLive, 1);
});

test("lowerIrToWasm uses a reused input slot for a materialized let destination", () => {
  const scratch = lowerWithTrackingScratch(
    buildIr((s) => {
      const input = s.get32(s.operand(0));
      const sum = s.i32Add(input, 1);

      s.set32(s.reg32("eax"), sum);
      s.set32(s.reg32("ebx"), sum);
      s.next();
    }),
    { canInlineGet32: () => false }
  );

  strictEqual(scratch.maxLive, 1);
});

async function instantiateLoweredBinary(program: IrBlock): Promise<(left: number, right: number) => number> {
  const module = await WebAssembly.compile(encodeLoweredBinaryModule(program));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (left: number, right: number) => number;
}

function encodeLoweredBinaryModule(program: IrBlock): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32, wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = lowerTestProgram(program);

  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function loweredBodyOpcodes(program: IrBlock): readonly number[] {
  const body = lowerTestProgram(program);

  body.end();
  return wasmBodyOpcodes(body.encode());
}

function lowerTestProgram(program: IrBlock): WasmFunctionBodyEncoder {
  const body = new WasmFunctionBodyEncoder(2);
  const scratch = new WasmLocalScratchAllocator(body);
  const regLocals: Partial<Record<Reg32, number>> = {
    eax: body.addLocal(wasmValueType.i32)
  };

  lowerIrToWasm(program, {
    body,
    scratch,
    expression: { canInlineGet32: () => true },
    emitGet32: (source) => emitGet32(body, regLocals, source),
    emitSet32: (target, value, helpers) => emitSet32(body, regLocals, target, value, helpers),
    emitSet32If: (condition, target, value, helpers) => emitSet32If(body, regLocals, condition, target, value, helpers),
    emitAddress32: (source) => {
      if (source.kind !== "operand") {
        unsupported(`${source.kind} address32`);
      }
      body.i32Const(0x1000 + source.index);
    },
    emitSetFlags: () => unsupported("flags.set"),
    emitMaterializeFlags: () => unsupported("flags.materialize"),
    emitBoundaryFlags: () => unsupported("flags.boundary"),
    emitAluFlagsCondition: () => unsupported("aluFlags.condition"),
    emitFlagProducerCondition: () => unsupported("flagProducer.condition"),
    emitNext: () => {
      body.localGet(requireRegLocal(regLocals, "eax"));
    },
    emitNextEip: () => {
      body.i32Const(nextEipValue);
    },
    emitJump: (target, helpers) => {
      helpers.emitValue(target);
    },
    emitConditionalJump: (condition, taken, notTaken, helpers) => {
      helpers.emitValue(condition);
      body.ifBlock(undefined, wasmValueType.i32);
      helpers.emitValue(taken);
      body.elseBlock();
      helpers.emitValue(notTaken);
      body.endBlock();
    },
    emitHostTrap: (vector, helpers) => {
      helpers.emitValue(vector);
    }
  });

  scratch.assertClear();
  return body;
}

function lowerWithTrackingScratch(
  program: IrBlock,
  expression: IrExpressionOptions
): TrackingScratchAllocator {
  const body = new WasmFunctionBodyEncoder(2);
  const scratch = new TrackingScratchAllocator(body);
  const regLocals: Partial<Record<Reg32, number>> = {
    eax: body.addLocal(wasmValueType.i32),
    ebx: body.addLocal(wasmValueType.i32)
  };

  lowerIrToWasm(program, {
    body,
    scratch,
    expression,
    emitGet32: (source) => emitGet32(body, regLocals, source),
    emitSet32: (target, value, helpers) => emitSet32(body, regLocals, target, value, helpers),
    emitSet32If: (condition, target, value, helpers) => emitSet32If(body, regLocals, condition, target, value, helpers),
    emitAddress32: () => unsupported("address32"),
    emitSetFlags: () => unsupported("flags.set"),
    emitMaterializeFlags: () => unsupported("flags.materialize"),
    emitBoundaryFlags: () => unsupported("flags.boundary"),
    emitAluFlagsCondition: () => unsupported("aluFlags.condition"),
    emitFlagProducerCondition: () => unsupported("flagProducer.condition"),
    emitNext: () => {},
    emitNextEip: () => {
      body.i32Const(nextEipValue);
    },
    emitJump: (target, helpers) => {
      helpers.emitValue(target);
    },
    emitConditionalJump: (condition, taken, notTaken, helpers) => {
      helpers.emitValue(condition);
      helpers.emitValue(taken);
      helpers.emitValue(notTaken);
    },
    emitHostTrap: (vector, helpers) => {
      helpers.emitValue(vector);
    }
  });

  scratch.assertClear();
  return scratch;
}

function emitGet32(
  body: WasmFunctionBodyEncoder,
  regLocals: Partial<Record<Reg32, number>>,
  source: IrStorageExpr
): void {
  switch (source.kind) {
    case "operand":
      if (source.index > 1) {
        throw new Error(`missing test operand: ${source.index}`);
      }
      body.localGet(source.index);
      return;
    case "reg":
      body.localGet(requireRegLocal(regLocals, source.reg));
      return;
    case "mem":
      unsupported("mem get32");
  }
}

function emitSet32(
  body: WasmFunctionBodyEncoder,
  regLocals: Partial<Record<Reg32, number>>,
  target: IrStorageExpr,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  if (target.kind !== "reg") {
    unsupported(`${target.kind} set32`);
  }

  helpers.emitValue(value);
  body.localSet(requireRegLocal(regLocals, target.reg));
}

function emitSet32If(
  body: WasmFunctionBodyEncoder,
  regLocals: Partial<Record<Reg32, number>>,
  condition: IrValueExpr,
  target: IrStorageExpr,
  value: IrValueExpr,
  helpers: WasmIrEmitHelpers
): void {
  helpers.emitValue(condition);
  body.ifBlock();
  emitSet32(body, regLocals, target, value, helpers);
  body.endBlock();
}

function requireRegLocal(regLocals: Partial<Record<Reg32, number>>, reg: Reg32): number {
  const local = regLocals[reg];

  if (local === undefined) {
    throw new Error(`missing test register local: ${reg}`);
  }

  return local;
}

function unsupported(message: string): never {
  throw new Error(`unsupported lower test hook: ${message}`);
}

class TrackingScratchAllocator extends WasmLocalScratchAllocator {
  readonly #liveLocals = new Set<number>();
  maxLive = 0;

  override allocLocal(type: WasmValueType): number {
    const local = super.allocLocal(type);

    this.#liveLocals.add(local);
    this.maxLive = Math.max(this.maxLive, this.#liveLocals.size);
    return local;
  }

  override freeLocal(index: number): void {
    super.freeLocal(index);
    this.#liveLocals.delete(index);
  }
}
