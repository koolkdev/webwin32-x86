import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildIr } from "../../../ir/build/builder.js";
import { createIrFlagSetOp } from "../../../ir/model/flags.js";
import { aluSemantic, incDecSemantic } from "../alu.js";
import { callSemantic, jccSemantic, jmpSemantic, retImmSemantic } from "../control.js";
import { cmpSemantic } from "../cmp.js";
import { leaSemantic } from "../lea.js";
import { intSemantic, nopSemantic } from "../misc.js";
import { movSemantic } from "../mov.js";
import { leaveSemantic, popSemantic } from "../stack.js";
import { testSemantic } from "../test.js";

const v = (id: number) => ({ kind: "var" as const, id });
const op = (index: number) => ({ kind: "operand" as const, index });
const reg = (reg: "esp") => ({ kind: "reg" as const, reg });
const mem = (address: ReturnType<typeof v>) => ({ kind: "mem" as const, address });
const c32 = (value: number) => ({ kind: "const32" as const, value });

test("mov semantic gets source, sets destination, and falls through", () => {
  deepStrictEqual(buildIr(movSemantic()), [
    { op: "get32", dst: v(0), source: op(1) },
    { op: "set32", target: op(0), value: v(0) },
    { op: "next" }
  ]);
});

test("nop semantic falls through without side effects", () => {
  deepStrictEqual(buildIr(nopSemantic()), [
    { op: "next" }
  ]);
});

test("int semantic reads the vector and exits to a host trap", () => {
  deepStrictEqual(buildIr(intSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "hostTrap", vector: v(0) }
  ]);
});

test("lea semantic computes address without getting the operand value", () => {
  const program = buildIr(leaSemantic());

  deepStrictEqual(program, [
    { op: "address32", dst: v(0), operand: op(1) },
    { op: "set32", target: op(0), value: v(0) },
    { op: "next" }
  ]);
  strictEqual(program.some((op) => op.op === "get32"), false);
});

test("add semantic sets add32 flags before destination writeback", () => {
  deepStrictEqual(buildIr(aluSemantic("add", 32)), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.add", dst: v(2), a: v(0), b: v(1) },
    createIrFlagSetOp("add32", { left: v(0), right: v(1), result: v(2) }),
    { op: "set32", target: op(0), value: v(2) },
    { op: "next" }
  ]);
});

test("inc semantic sets partial inc32 flags before destination writeback", () => {
  deepStrictEqual(buildIr(incDecSemantic("inc", 32)), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
    createIrFlagSetOp("inc32", { left: v(0), result: v(1) }),
    { op: "set32", target: op(0), value: v(1) },
    { op: "next" }
  ]);
});

test("logical alu semantics set logic32 flags before destination writeback", () => {
  deepStrictEqual(buildIr(aluSemantic("and", 32)), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.and", dst: v(2), a: v(0), b: v(1) },
    createIrFlagSetOp("logic32", { result: v(2) }),
    { op: "set32", target: op(0), value: v(2) },
    { op: "next" }
  ]);
  deepStrictEqual(buildIr(aluSemantic("or", 32)), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.or", dst: v(2), a: v(0), b: v(1) },
    createIrFlagSetOp("logic32", { result: v(2) }),
    { op: "set32", target: op(0), value: v(2) },
    { op: "next" }
  ]);
});

test("cmp semantic subtracts for flags only", () => {
  const program = buildIr(cmpSemantic());

  deepStrictEqual(program, [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
    createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
    { op: "next" }
  ]);
  strictEqual(program.some((op) => op.op === "set32"), false);
});

test("test semantic uses i32.and and logic32 flags", () => {
  deepStrictEqual(buildIr(testSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.and", dst: v(2), a: v(0), b: v(1) },
    createIrFlagSetOp("logic32", { result: v(2) }),
    { op: "next" }
  ]);
});

test("pop semantic expands to generic stack get/set operations", () => {
  deepStrictEqual(buildIr(popSemantic()), [
    { op: "get32", dst: v(0), source: reg("esp") },
    { op: "get32", dst: v(1), source: mem(v(0)) },
    { op: "i32.add", dst: v(2), a: v(0), b: c32(4) },
    { op: "set32", target: reg("esp"), value: v(2) },
    { op: "set32", target: op(0), value: v(1) },
    { op: "next" }
  ]);
});

test("leave semantic reads saved frame before updating esp and ebp", () => {
  deepStrictEqual(buildIr(leaveSemantic()), [
    { op: "get32", dst: v(0), source: { kind: "reg", reg: "ebp" } },
    { op: "get32", dst: v(1), source: mem(v(0)) },
    { op: "i32.add", dst: v(2), a: v(0), b: c32(4) },
    { op: "set32", target: reg("esp"), value: v(2) },
    { op: "set32", target: { kind: "reg", reg: "ebp" }, value: v(1) },
    { op: "next" }
  ]);
});

test("jmp semantic resolves target value before jumping", () => {
  deepStrictEqual(buildIr(jmpSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "jump", target: v(0) }
  ]);
});

test("call semantic resolves target before pushing return address", () => {
  deepStrictEqual(buildIr(callSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: reg("esp") },
    { op: "i32.sub", dst: v(2), a: v(1), b: c32(4) },
    { op: "set32", target: mem(v(2)), value: { kind: "nextEip" } },
    { op: "set32", target: reg("esp"), value: v(2) },
    { op: "jump", target: v(0) }
  ]);
});

test("ret imm semantic adjusts esp explicitly after popping target", () => {
  deepStrictEqual(buildIr(retImmSemantic()), [
    { op: "get32", dst: v(0), source: reg("esp") },
    { op: "get32", dst: v(1), source: mem(v(0)) },
    { op: "i32.add", dst: v(2), a: v(0), b: c32(4) },
    { op: "set32", target: reg("esp"), value: v(2) },
    { op: "get32", dst: v(3), source: op(0) },
    { op: "get32", dst: v(4), source: reg("esp") },
    { op: "i32.add", dst: v(5), a: v(4), b: v(3) },
    { op: "set32", target: reg("esp"), value: v(5) },
    { op: "jump", target: v(1) }
  ]);
});

test("jcc semantic resolves relative target value before conditional jump", () => {
  deepStrictEqual(buildIr(jccSemantic("NE")), [
    { op: "aluFlags.condition", dst: v(0), cc: "NE" },
    { op: "get32", dst: v(1), source: op(0) },
    {
      op: "conditionalJump",
      condition: v(0),
      taken: v(1),
      notTaken: { kind: "nextEip" }
    }
  ]);
});
