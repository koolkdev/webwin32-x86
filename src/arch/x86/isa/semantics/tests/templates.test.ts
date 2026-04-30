import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildSir } from "../../../sir/builder.js";
import { aluSemantic } from "../alu.js";
import { callSemantic, jccSemantic, jmpSemantic, retImmSemantic } from "../control.js";
import { cmpSemantic } from "../cmp.js";
import { leaSemantic } from "../lea.js";
import { intSemantic, nopSemantic } from "../misc.js";
import { movSemantic } from "../mov.js";
import { popSemantic } from "../stack.js";
import { testSemantic } from "../test.js";

const v = (id: number) => ({ kind: "var" as const, id });
const op = (index: number) => ({ kind: "operand" as const, index });
const reg = (reg: "esp") => ({ kind: "reg" as const, reg });
const mem = (address: ReturnType<typeof v>) => ({ kind: "mem" as const, address });
const c32 = (value: number) => ({ kind: "const32" as const, value });

test("mov semantic gets source, sets destination, and falls through", () => {
  deepStrictEqual(buildSir(movSemantic()), [
    { op: "get32", dst: v(0), source: op(1) },
    { op: "set32", target: op(0), value: v(0) },
    { op: "next" }
  ]);
});

test("nop semantic falls through without side effects", () => {
  deepStrictEqual(buildSir(nopSemantic()), [
    { op: "next" }
  ]);
});

test("int semantic reads the vector and exits to a host trap", () => {
  deepStrictEqual(buildSir(intSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "hostTrap", vector: v(0) }
  ]);
});

test("lea semantic computes address without getting the operand value", () => {
  const program = buildSir(leaSemantic());

  deepStrictEqual(program, [
    { op: "address32", dst: v(0), operand: op(1) },
    { op: "set32", target: op(0), value: v(0) },
    { op: "next" }
  ]);
  strictEqual(program.some((op) => op.op === "get32"), false);
});

test("add semantic sets add32 flags before destination writeback", () => {
  deepStrictEqual(buildSir(aluSemantic("add", 32)), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.add", dst: v(2), a: v(0), b: v(1) },
    {
      op: "flags.set",
      producer: "add32",
      inputs: { left: v(0), right: v(1), result: v(2) }
    },
    { op: "set32", target: op(0), value: v(2) },
    { op: "next" }
  ]);
});

test("cmp semantic subtracts for flags only", () => {
  const program = buildSir(cmpSemantic());

  deepStrictEqual(program, [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
    {
      op: "flags.set",
      producer: "sub32",
      inputs: { left: v(0), right: v(1), result: v(2) }
    },
    { op: "next" }
  ]);
  strictEqual(program.some((op) => op.op === "set32"), false);
});

test("test semantic uses i32.and and logic32 flags", () => {
  deepStrictEqual(buildSir(testSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: op(1) },
    { op: "i32.and", dst: v(2), a: v(0), b: v(1) },
    { op: "flags.set", producer: "logic32", inputs: { result: v(2) } },
    { op: "next" }
  ]);
});

test("pop semantic expands to generic stack get/set operations", () => {
  deepStrictEqual(buildSir(popSemantic()), [
    { op: "get32", dst: v(0), source: reg("esp") },
    { op: "get32", dst: v(1), source: mem(v(0)) },
    { op: "i32.add", dst: v(2), a: v(0), b: c32(4) },
    { op: "set32", target: reg("esp"), value: v(2) },
    { op: "set32", target: op(0), value: v(1) },
    { op: "next" }
  ]);
});

test("jmp semantic resolves target value before jumping", () => {
  deepStrictEqual(buildSir(jmpSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "jump", target: v(0) }
  ]);
});

test("call semantic resolves target before pushing return address", () => {
  deepStrictEqual(buildSir(callSemantic()), [
    { op: "get32", dst: v(0), source: op(0) },
    { op: "get32", dst: v(1), source: reg("esp") },
    { op: "i32.sub", dst: v(2), a: v(1), b: c32(4) },
    { op: "set32", target: reg("esp"), value: v(2) },
    { op: "set32", target: mem(v(2)), value: { kind: "nextEip" } },
    { op: "jump", target: v(0) }
  ]);
});

test("ret imm semantic adjusts esp explicitly after popping target", () => {
  deepStrictEqual(buildSir(retImmSemantic()), [
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
  deepStrictEqual(buildSir(jccSemantic("NE")), [
    { op: "condition", dst: v(0), cc: "NE" },
    { op: "get32", dst: v(1), source: op(0) },
    {
      op: "conditionalJump",
      condition: v(0),
      taken: v(1),
      notTaken: { kind: "nextEip" }
    }
  ]);
});
