import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { aluSemantic } from "../alu.js";
import { callSemantic, jccSemantic, jmpSemantic, retImmSemantic } from "../control.js";
import { cmpSemantic } from "../cmp.js";
import { leaSemantic } from "../lea.js";
import { movSemantic } from "../mov.js";
import { popSemantic } from "../stack.js";
import { testSemantic } from "../test.js";
import { buildSir } from "../../../sir/builder.js";

test("mov semantic gets source, sets destination, and falls through", () => {
  deepStrictEqual(buildSir(movSemantic()), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "src" }
    },
    {
      op: "set32",
      target: { kind: "operand", name: "dst" },
      value: { kind: "var", name: "value_0" }
    },
    { op: "next" }
  ]);
});

test("lea semantic computes address without getting the operand value", () => {
  const program = buildSir(leaSemantic());

  deepStrictEqual(program, [
    {
      op: "address32",
      dst: { kind: "var", name: "address_0" },
      operand: { kind: "operand", name: "src" }
    },
    {
      op: "set32",
      target: { kind: "operand", name: "dst" },
      value: { kind: "var", name: "address_0" }
    },
    { op: "next" }
  ]);
  strictEqual(program.some((op) => op.op === "get32"), false);
});

test("add semantic sets add32 flags before destination writeback", () => {
  deepStrictEqual(buildSir(aluSemantic("add", 32)), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "dst" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_1" },
      source: { kind: "operand", name: "src" }
    },
    {
      op: "i32.add",
      dst: { kind: "var", name: "result_0" },
      a: { kind: "var", name: "value_0" },
      b: { kind: "var", name: "value_1" }
    },
    {
      op: "flags.set",
      producer: "add32",
      inputs: {
        left: { kind: "var", name: "value_0" },
        right: { kind: "var", name: "value_1" },
        result: { kind: "var", name: "result_0" }
      }
    },
    {
      op: "set32",
      target: { kind: "operand", name: "dst" },
      value: { kind: "var", name: "result_0" }
    },
    { op: "next" }
  ]);
});

test("cmp semantic subtracts for flags only", () => {
  const program = buildSir(cmpSemantic());

  deepStrictEqual(program, [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "left" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_1" },
      source: { kind: "operand", name: "right" }
    },
    {
      op: "i32.sub",
      dst: { kind: "var", name: "result_0" },
      a: { kind: "var", name: "value_0" },
      b: { kind: "var", name: "value_1" }
    },
    {
      op: "flags.set",
      producer: "sub32",
      inputs: {
        left: { kind: "var", name: "value_0" },
        right: { kind: "var", name: "value_1" },
        result: { kind: "var", name: "result_0" }
      }
    },
    { op: "next" }
  ]);
  strictEqual(program.some((op) => op.op === "set32"), false);
});

test("test semantic uses i32.and and logic32 flags", () => {
  deepStrictEqual(buildSir(testSemantic()), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "left" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_1" },
      source: { kind: "operand", name: "right" }
    },
    {
      op: "i32.and",
      dst: { kind: "var", name: "result_0" },
      a: { kind: "var", name: "value_0" },
      b: { kind: "var", name: "value_1" }
    },
    {
      op: "flags.set",
      producer: "logic32",
      inputs: {
        result: { kind: "var", name: "result_0" }
      }
    },
    { op: "next" }
  ]);
});

test("pop semantic expands to generic stack get/set operations", () => {
  deepStrictEqual(buildSir(popSemantic()), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "reg", reg: "esp" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_1" },
      source: {
        kind: "mem",
        address: { kind: "var", name: "value_0" }
      }
    },
    {
      op: "i32.add",
      dst: { kind: "var", name: "result_0" },
      a: { kind: "var", name: "value_0" },
      b: { kind: "const32", value: 4 }
    },
    {
      op: "set32",
      target: { kind: "reg", reg: "esp" },
      value: { kind: "var", name: "result_0" }
    },
    {
      op: "set32",
      target: { kind: "operand", name: "dst" },
      value: { kind: "var", name: "value_1" }
    },
    { op: "next" }
  ]);
});

test("jmp semantic resolves target value before jumping", () => {
  deepStrictEqual(buildSir(jmpSemantic()), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "target" }
    },
    {
      op: "jump",
      target: { kind: "var", name: "value_0" }
    }
  ]);
});

test("call semantic resolves target before pushing return address", () => {
  deepStrictEqual(buildSir(callSemantic()), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "target" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_1" },
      source: { kind: "reg", reg: "esp" }
    },
    {
      op: "i32.sub",
      dst: { kind: "var", name: "result_0" },
      a: { kind: "var", name: "value_1" },
      b: { kind: "const32", value: 4 }
    },
    {
      op: "set32",
      target: { kind: "reg", reg: "esp" },
      value: { kind: "var", name: "result_0" }
    },
    {
      op: "set32",
      target: {
        kind: "mem",
        address: { kind: "var", name: "result_0" }
      },
      value: { kind: "nextEip" }
    },
    {
      op: "jump",
      target: { kind: "var", name: "value_0" }
    }
  ]);
});

test("ret imm semantic adjusts esp explicitly after popping target", () => {
  deepStrictEqual(buildSir(retImmSemantic()), [
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "reg", reg: "esp" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_1" },
      source: {
        kind: "mem",
        address: { kind: "var", name: "value_0" }
      }
    },
    {
      op: "i32.add",
      dst: { kind: "var", name: "result_0" },
      a: { kind: "var", name: "value_0" },
      b: { kind: "const32", value: 4 }
    },
    {
      op: "set32",
      target: { kind: "reg", reg: "esp" },
      value: { kind: "var", name: "result_0" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_2" },
      source: { kind: "operand", name: "stackBytes" }
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_3" },
      source: { kind: "reg", reg: "esp" }
    },
    {
      op: "i32.add",
      dst: { kind: "var", name: "result_1" },
      a: { kind: "var", name: "value_3" },
      b: { kind: "var", name: "value_2" }
    },
    {
      op: "set32",
      target: { kind: "reg", reg: "esp" },
      value: { kind: "var", name: "result_1" }
    },
    {
      op: "jump",
      target: { kind: "var", name: "value_1" }
    }
  ]);
});

test("jcc semantic resolves relative target value before conditional jump", () => {
  deepStrictEqual(buildSir(jccSemantic("NE")), [
    {
      op: "condition",
      dst: { kind: "var", name: "condition_0" },
      cc: "NE"
    },
    {
      op: "get32",
      dst: { kind: "var", name: "value_0" },
      source: { kind: "operand", name: "target" }
    },
    {
      op: "conditionalJump",
      condition: { kind: "var", name: "condition_0" },
      taken: { kind: "var", name: "value_0" },
      notTaken: { kind: "nextEip" }
    }
  ]);
});
