import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import { wasmOpcode, wasmValueType } from "#backends/wasm/encoder/types.js";
import { cleanValueWidth, type ValueWidth } from "#backends/wasm/codegen/value-width.js";
import type { IrStorageExpr, IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import { extractOnlyWasmFunctionBody, wasmBodyOpcodes } from "#backends/wasm/tests/body-opcodes.js";
import type { JitValue } from "#backends/wasm/jit/ir/values.js";
import {
  JitValueLocalStore,
  type JitValueUseCount
} from "#backends/wasm/jit/codegen/emit/value-local-store.js";
import { encodeJitIrBlock } from "#backends/wasm/jit/block.js";
import type { JitIrBlock } from "#backends/wasm/jit/ir/types.js";
import { emitJitIrWithContext } from "#backends/wasm/jit/codegen/emit/ir-context.js";
import type { JitStateSnapshot } from "#backends/wasm/jit/codegen/plan/types.js";
import { createJitIrState } from "#backends/wasm/jit/state/state.js";
import type { Reg32 } from "#x86/isa/types.js";
import { emitPlannedExpression } from "./expression-cache-test-helpers.js";

test("JitValueLocalStore reuses one local for equal non-trivial values", () => {
  const body = new WasmFunctionBodyEncoder();
  const first = addValue("eax", 1);
  const second = addValue("eax", 1);
  const store = new JitValueLocalStore(body, useCounts([{ value: first, useCount: 2 }]));
  let emitted = 0;

  store.emitForUse(first, () => emitAdd(body, () => { emitted += 1; }));
  store.emitForUse(second, unexpectedEmitter);
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(emitted, 1);
  strictEqual(totalLocalCount(body.encode()), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Add), 1);
  deepStrictEqual(localOpcodes(opcodes), [wasmOpcode.localTee, wasmOpcode.localGet]);
});

test("JitValueLocalStore reuses structurally equal binary expressions", () => {
  const body = new WasmFunctionBodyEncoder();
  const first = {
    kind: "value.binary",
    type: "i32",
    operator: "xor",
    a: addValue("eax", 1),
    b: addValue("ebx", 2)
  } as const satisfies JitValue;
  const second = {
    kind: "value.binary",
    type: "i32",
    operator: "xor",
    a: addValue("eax", 1),
    b: addValue("ebx", 2)
  } as const satisfies JitValue;
  const store = new JitValueLocalStore(body, useCounts([{ value: first, useCount: 2 }]));
  let emitted = 0;

  store.emitForUse(first, () => emitXorOfAdds(body, () => { emitted += 1; }));
  store.emitForUse(second, unexpectedEmitter);
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(emitted, 1);
  strictEqual(totalLocalCount(body.encode()), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Xor), 1);
  deepStrictEqual(localOpcodes(opcodes), [wasmOpcode.localTee, wasmOpcode.localGet]);
});

test("JitValueLocalStore does not cache constants", () => {
  const body = new WasmFunctionBodyEncoder();
  const value = { kind: "const", type: "i32", value: 7 } as const satisfies JitValue;
  const store = new JitValueLocalStore(body, useCounts([{ value, useCount: 3 }]));
  let emitted = 0;

  store.emitForUse(value, () => emitConst(body, 7, () => { emitted += 1; }));
  store.emitForUse(value, () => emitConst(body, 7, () => { emitted += 1; }));
  store.emitForUse(value, () => emitConst(body, 7, () => { emitted += 1; }));
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(emitted, 3);
  strictEqual(totalLocalCount(body.encode()), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Const), 3);
  deepStrictEqual(localOpcodes(opcodes), []);
});

test("JitValueLocalStore does not cache when reuse only ties repeated inline cost", () => {
  const body = new WasmFunctionBodyEncoder();
  const value = {
    kind: "value.unary",
    type: "i32",
    operator: "extend8_s",
    value: { kind: "reg", reg: "eax" }
  } as const satisfies JitValue;
  const store = new JitValueLocalStore(body, useCounts([{ value, useCount: 2 }]));
  let emitted = 0;

  store.emitForUse(value, () => emitExtend8(body, () => { emitted += 1; }));
  store.emitForUse(value, () => emitExtend8(body, () => { emitted += 1; }));
  body.end();

  strictEqual(emitted, 2);
  strictEqual(totalLocalCount(body.encode()), 0);
  deepStrictEqual(localOpcodes(wasmBodyOpcodes(body.encode())), []);
});

test("JitValueLocalStore maybeMaterializeForLater reports whether it emitted local.set", () => {
  const body = new WasmFunctionBodyEncoder();
  const value = addValue("eax", 1);
  const store = new JitValueLocalStore(body, useCounts([{ value, useCount: 2 }]));
  let emitted = 0;

  strictEqual(store.maybeMaterializeForLater(value, () => emitAdd(body, () => { emitted += 1; })), true);
  strictEqual(store.maybeMaterializeForLater(value, unexpectedEmitter), false);
  store.emitForUse(value, unexpectedEmitter);
  body.end();

  strictEqual(emitted, 1);
  deepStrictEqual(localOpcodes(wasmBodyOpcodes(body.encode())), [wasmOpcode.localSet, wasmOpcode.localGet]);
});

test("JIT expression emission uses local.tee for cached optimized expression vars", () => {
  const opcodes = wasmBodyOpcodes(extractOnlyWasmFunctionBody(encodeJitIrBlock([repeatedInlineExpressionBlock()])));

  strictEqual(countOpcode(opcodes, wasmOpcode.localTee), 1);
});

test("JIT expression cache does not cache let32-backed var reads", () => {
  const opcodes = emitPlannedExpression([
    { op: "let32", dst: { kind: "var", id: 0 }, value: addExpr("eax", 1) },
    { op: "hostTrap", vector: { kind: "var", id: 0 } },
    { op: "hostTrap", vector: { kind: "var", id: 0 } }
  ]);

  strictEqual(countOpcode(opcodes, wasmOpcode.localTee), 0);
});

test("JIT expression cache does not reuse one-before and one-after clobber", () => {
  const opcodes = emitPlannedExpression([
    { op: "set", target: reg("ebx"), value: addExpr("eax", 1), accessWidth: 32 },
    { op: "set", target: reg("eax"), value: const32(5), accessWidth: 32 },
    { op: "set", target: reg("ecx"), value: addExpr("eax", 1), accessWidth: 32 }
  ]);

  strictEqual(countOpcode(opcodes, wasmOpcode.localTee), 0);
});

test("JIT expression cache invalidates cached values across written-register epochs", () => {
  const opcodes = emitPlannedExpression([
    { op: "hostTrap", vector: addExpr("eax", 1) },
    { op: "hostTrap", vector: addExpr("eax", 1) },
    { op: "set", target: reg("eax"), value: const32(5), accessWidth: 32 },
    { op: "hostTrap", vector: addExpr("eax", 1) },
    { op: "hostTrap", vector: addExpr("eax", 1) }
  ], { cloneWriteTargetsForNotification: true });

  deepStrictEqual(localOpcodes(opcodes).filter((opcode) =>
    opcode === wasmOpcode.localTee ||
    opcode === wasmOpcode.localGet
  ), [wasmOpcode.localTee, wasmOpcode.localGet, wasmOpcode.localTee, wasmOpcode.localGet]);
});

test("JIT expression cache prefers repeated parent expressions over nested children", () => {
  const opcodes = emitPlannedExpression([
    { op: "hostTrap", vector: parentExpr() },
    { op: "hostTrap", vector: parentExpr() }
  ]);

  strictEqual(countOpcode(opcodes, wasmOpcode.localTee), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Xor), 1);
});

test("JIT emission consumes prebuilt expression blocks from instruction plans", () => {
  const body = new WasmFunctionBodyEncoder();
  const scratch = new WasmLocalScratchAllocator(body);
  const exitLocal = body.addLocal(wasmValueType.i64);
  const state = createJitIrState(body, [{ regs: [] }]);
  const preInstructionState = stateSnapshot("preInstruction", 0x1000, 0);

  emitJitIrWithContext({
    body,
    scratch,
    state,
    exit: { exitLocal, exitLabelDepth: 0 },
    exitPoints: [],
    instructions: [{
      instructionId: "prebuilt-expression-block",
      eip: 0x1000,
      nextEip: 0x1001,
      nextMode: "continue",
      preInstructionState,
      postInstructionState: stateSnapshot("postInstruction", 0x1001, 1),
      preInstructionExitPointCount: 0,
      exitPointCount: 0,
      operands: [],
      expressionBlock: [
        { op: "set", target: reg("ebx"), value: const32(0x2a), accessWidth: 32 },
        { op: "next" }
      ]
    }]
  });
  scratch.assertClear();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.i32Const), 1);
});

test("JitValueLocalStore forgetWhere invalidates only matching values", () => {
  const body = new WasmFunctionBodyEncoder();
  const eax = addValue("eax", 1);
  const ebx = addValue("ebx", 1);
  const store = new JitValueLocalStore(body, useCounts([
    { value: eax, useCount: 2 },
    { value: ebx, useCount: 2 }
  ]));
  let eaxEmits = 0;
  let ebxEmits = 0;

  store.emitForUse(eax, () => emitAdd(body, () => { eaxEmits += 1; }));
  store.emitForUse(ebx, () => emitAdd(body, () => { ebxEmits += 1; }));
  store.forgetWhere((value) => value.kind === "value.binary" && value.a.kind === "reg" && value.a.reg === "eax");
  store.emitForUse(eax, () => emitAdd(body, () => { eaxEmits += 1; }));
  store.emitForUse(ebx, unexpectedEmitter);
  body.end();

  strictEqual(eaxEmits, 2);
  strictEqual(ebxEmits, 1);
  deepStrictEqual(localOpcodes(wasmBodyOpcodes(body.encode())), [
    wasmOpcode.localTee,
    wasmOpcode.localTee,
    wasmOpcode.localTee,
    wasmOpcode.localGet
  ]);
});

function addValue(reg: "eax" | "ebx", value: number): JitValue {
  return {
    kind: "value.binary",
    type: "i32",
    operator: "add",
    a: { kind: "reg", reg },
    b: { kind: "const", type: "i32", value }
  };
}

function useCounts(counts: readonly JitValueUseCount[]): readonly JitValueUseCount[] {
  return counts;
}

function reg(regName: Reg32): IrStorageExpr {
  return { kind: "reg", reg: regName };
}

function const32(value: number): IrValueExpr {
  return { kind: "const", type: "i32", value };
}

function addExpr(regName: Reg32, value: number): IrValueExpr {
  return {
    kind: "value.binary",
    type: "i32",
    operator: "add",
    a: { kind: "source", source: reg(regName), accessWidth: 32 },
    b: const32(value)
  };
}

function parentExpr(): IrValueExpr {
  return {
    kind: "value.binary",
    type: "i32",
    operator: "xor",
    a: addExpr("eax", 1),
    b: const32(0xff)
  };
}

function emitAdd(body: WasmFunctionBodyEncoder, onEmit: () => void): ValueWidth {
  onEmit();
  body.i32Const(10).i32Const(1).i32Add();
  return cleanValueWidth(32);
}

function emitXorOfAdds(body: WasmFunctionBodyEncoder, onEmit: () => void): ValueWidth {
  onEmit();
  body.i32Const(10).i32Const(1).i32Add();
  body.i32Const(20).i32Const(2).i32Add();
  body.i32Xor();
  return cleanValueWidth(32);
}

function emitConst(body: WasmFunctionBodyEncoder, value: number, onEmit: () => void): ValueWidth {
  onEmit();
  body.i32Const(value);
  return cleanValueWidth(32);
}

function emitExtend8(body: WasmFunctionBodyEncoder, onEmit: () => void): ValueWidth {
  onEmit();
  body.i32Const(0x80).i32Extend8S();
  return cleanValueWidth(32);
}

function unexpectedEmitter(): ValueWidth {
  throw new Error("unexpected value emission");
}

function localOpcodes(opcodes: readonly number[]): readonly number[] {
  return opcodes.filter((opcode) =>
    opcode === wasmOpcode.localGet ||
    opcode === wasmOpcode.localSet ||
    opcode === wasmOpcode.localTee
  );
}

function countOpcode(opcodes: readonly number[], opcode: number): number {
  return opcodes.filter((entry) => entry === opcode).length;
}

function totalLocalCount(bytes: Uint8Array<ArrayBuffer>): number {
  let offset = 0;
  const groups = readU32Leb128(bytes, offset);
  let total = 0;

  offset = groups.nextOffset;

  for (let index = 0; index < groups.value; index += 1) {
    const groupSize = readU32Leb128(bytes, offset);

    total += groupSize.value;
    offset = groupSize.nextOffset + 1;
  }

  return total;
}

function readU32Leb128(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number
): Readonly<{ value: number; nextOffset: number }> {
  let value = 0;
  let shift = 0;

  while (true) {
    const byte = bytes[offset];

    if (byte === undefined) {
      throw new Error(`unexpected end of LEB128 at ${offset}`);
    }

    value |= (byte & 0x7f) << shift;
    offset += 1;

    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset };
    }

    shift += 7;
  }
}

function stateSnapshot(
  kind: JitStateSnapshot["kind"],
  eip: number,
  instructionCountDelta: number
): JitStateSnapshot {
  return {
    kind,
    eip,
    instructionCountDelta,
    committedRegs: [],
    speculativeRegs: [],
    committedFlags: { mask: 0 },
    speculativeFlags: { mask: 0 }
  };
}

function repeatedInlineExpressionBlock(): JitIrBlock {
  return {
    instructions: [{
      instructionId: "cache-test",
      eip: 0x1000,
      nextEip: 0x1001,
      nextMode: "exit",
      operands: [],
      ir: [
        { op: "get", dst: { kind: "var", id: 0 }, source: { kind: "reg", reg: "eax" } },
        {
          op: "value.binary",
          type: "i32",
          operator: "add",
          dst: { kind: "var", id: 1 },
          a: { kind: "var", id: 0 },
          b: { kind: "const", type: "i32", value: 1 }
        },
        { op: "get", dst: { kind: "var", id: 2 }, source: { kind: "reg", reg: "eax" } },
        {
          op: "value.binary",
          type: "i32",
          operator: "add",
          dst: { kind: "var", id: 3 },
          a: { kind: "var", id: 2 },
          b: { kind: "const", type: "i32", value: 1 }
        },
        {
          op: "conditionalJump",
          condition: { kind: "const", type: "i32", value: 0 },
          taken: { kind: "var", id: 1 },
          notTaken: { kind: "var", id: 3 }
        }
      ]
    }]
  };
}
