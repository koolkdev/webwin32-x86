import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import {
  irOpDst,
  irOpIsTerminator,
  irOpResult,
  irOpStorageReads,
  irOpStorageWrites,
  irOpValueUses
} from "#x86/ir/model/op-semantics.js";
import type { IrOp } from "#x86/ir/model/types.js";
import { const32, irVar } from "#x86/ir/build/builder.js";

test("IR op semantics exposes results, dsts, and terminators", () => {
  const localDef: IrOp = { op: "i32.add", dst: irVar(1), a: irVar(0), b: const32(1) };
  const storageRead: IrOp = { op: "get32", dst: irVar(2), source: { kind: "reg", reg: "eax" } };
  const store: IrOp = { op: "set32", target: { kind: "reg", reg: "eax" }, value: irVar(1) };

  deepStrictEqual(irOpResult(localDef), { kind: "value", dst: irVar(1), sideEffect: "none" });
  deepStrictEqual(irOpResult(storageRead), { kind: "value", dst: irVar(2), sideEffect: "storageRead" });
  deepStrictEqual(irOpResult(store), { kind: "none" });
  strictEqual(irOpDst(localDef)?.id, 1);
  strictEqual(irOpDst(store), undefined);
  strictEqual(irOpIsTerminator({ op: "next" }), true);
  strictEqual(irOpIsTerminator(localDef), false);
});

test("IR op semantics exposes value and storage uses with roles", () => {
  const target = { kind: "mem" as const, address: irVar(1) };
  const op: IrOp = {
    op: "set32.if",
    condition: irVar(0),
    target,
    value: irVar(2)
  };

  deepStrictEqual(irOpValueUses(op), [
    { value: irVar(0), role: "condition" },
    { value: irVar(1), role: "value" },
    { value: irVar(2), role: "value" }
  ]);
  deepStrictEqual(irOpStorageReads(op), []);
  deepStrictEqual(irOpStorageWrites(op), [target]);
});
