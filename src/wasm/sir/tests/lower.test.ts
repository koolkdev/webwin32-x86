import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { Reg32 } from "../../../arch/x86/isa/types.js";
import { buildSir } from "../../../arch/x86/sir/builder.js";
import type { SirExpressionOptions, SirStorageExpr, SirValueExpr } from "../../../arch/x86/sir/expressions.js";
import type { SirProgram } from "../../../arch/x86/sir/types.js";
import { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { WasmLocalScratchAllocator } from "../../encoder/local-scratch.js";
import { WasmModuleEncoder } from "../../encoder/module.js";
import { wasmValueType, type WasmValueType } from "../../encoder/types.js";
import { lowerSirToWasm, type WasmSirEmitHelpers } from "../lower.js";

const nextEipValue = 0x1234_5678;

test("lowerSirToWasm lowers arithmetic through storage callbacks", async () => {
  const run = await instantiateLoweredBinary(
    buildSir((s) => {
      const left = s.get32(s.operand(0));
      const right = s.get32(s.operand(1));
      const adjusted = s.i32Add(left, 9);

      s.set32(s.reg32("eax"), s.i32Xor(adjusted, right));
    })
  );

  strictEqual(run(0x10, 0x20), 0x39);
  strictEqual(run(0, 0), 9);
});

test("lowerSirToWasm lowers conditional control values with nested emitValue", async () => {
  const run = await instantiateLoweredBinary(
    buildSir((s) => {
      const left = s.get32(s.operand(0));
      const right = s.get32(s.operand(1));
      const sum = s.i32Add(left, right);

      s.conditionalJump(s.i32And(sum, 1), sum, s.nextEip());
    })
  );

  strictEqual(run(1, 2), 3);
  strictEqual(run(2, 2), nextEipValue);
});

test("lowerSirToWasm uses planned slots for non-overlapping SIR locals", () => {
  const scratch = lowerWithTrackingScratch(
    buildSir((s) => {
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

test("lowerSirToWasm uses a reused input slot for a materialized let destination", () => {
  const scratch = lowerWithTrackingScratch(
    buildSir((s) => {
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

async function instantiateLoweredBinary(program: SirProgram): Promise<(left: number, right: number) => number> {
  const module = await WebAssembly.compile(encodeLoweredBinaryModule(program));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (left: number, right: number) => number;
}

function encodeLoweredBinaryModule(program: SirProgram): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32, wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(2);
  const scratch = new WasmLocalScratchAllocator(body);
  const regLocals: Partial<Record<Reg32, number>> = {
    eax: body.addLocal(wasmValueType.i32)
  };

  lowerSirToWasm(program, {
    body,
    scratch,
    expression: { canInlineGet32: () => true },
    emitGet32: (source) => emitGet32(body, regLocals, source),
    emitSet32: (target, value, helpers) => emitSet32(body, regLocals, target, value, helpers),
    emitAddress32: (source) => {
      if (source.kind !== "operand") {
        unsupported(`${source.kind} address32`);
      }
      body.i32Const(0x1000 + source.index);
    },
    emitSetFlags: () => unsupported("flags.set"),
    emitMaterializeFlags: () => unsupported("flags.materialize"),
    emitCondition: () => unsupported("condition"),
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
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function lowerWithTrackingScratch(
  program: SirProgram,
  expression: SirExpressionOptions
): TrackingScratchAllocator {
  const body = new WasmFunctionBodyEncoder(2);
  const scratch = new TrackingScratchAllocator(body);
  const regLocals: Partial<Record<Reg32, number>> = {
    eax: body.addLocal(wasmValueType.i32),
    ebx: body.addLocal(wasmValueType.i32)
  };

  lowerSirToWasm(program, {
    body,
    scratch,
    expression,
    emitGet32: (source) => emitGet32(body, regLocals, source),
    emitSet32: (target, value, helpers) => emitSet32(body, regLocals, target, value, helpers),
    emitAddress32: () => unsupported("address32"),
    emitSetFlags: () => unsupported("flags.set"),
    emitMaterializeFlags: () => unsupported("flags.materialize"),
    emitCondition: () => unsupported("condition"),
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
  source: SirStorageExpr
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
  target: SirStorageExpr,
  value: SirValueExpr,
  helpers: WasmSirEmitHelpers
): void {
  if (target.kind !== "reg") {
    unsupported(`${target.kind} set32`);
  }

  helpers.emitValue(value);
  body.localSet(requireRegLocal(regLocals, target.reg));
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
