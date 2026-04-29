import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildSir } from "../../../sir/builder.js";
import type { SemanticTemplate } from "../../../sir/types.js";
import { X86_32_CORE } from "../../index.js";
import { expandInstructionSpec } from "../../schema/builders.js";
import type { InstructionSpec } from "../../schema/types.js";

test("x86-32 core registers the initial instruction surface", () => {
  strictEqual(X86_32_CORE.name, "x86-32-core");
  strictEqual(X86_32_CORE.instructions.length, 71);

  const ids = X86_32_CORE.instructions.map((spec) => spec.id);

  for (const id of [
    "mov.r32_rm32",
    "mov.rm32_r32",
    "mov.r32_imm32",
    "lea.r32_m32",
    "add.rm32_imm8",
    "sub.rm32_imm8",
    "xor.eax_imm32",
    "cmp.rm32_imm8",
    "test.rm32_imm32",
    "push.r32",
    "pop.r32",
    "jmp.rel8",
    "call.rm32",
    "ret.near",
    "ret.imm16",
    "jne.rel8",
    "jne.rel32"
  ]) {
    strictEqual(ids.includes(id), true, `missing ${id}`);
  }
});

test("slash-r forms use ModRM operands without an explicit ModRM match", () => {
  const spec = instruction("mov.r32_rm32");

  deepStrictEqual(spec.opcode, [0x8b]);
  strictEqual(spec.modrm, undefined);
  deepStrictEqual(spec.operands, [
    { kind: "modrm.reg", type: "reg32" },
    { kind: "modrm.rm", type: "rm32" }
  ]);
  deepStrictEqual(spec.format, { syntax: "mov {0}, {1}" });
});

test("group opcode forms use modrm.match.reg for Intel slash-digit notation", () => {
  const sub = instruction("sub.rm32_imm8");
  const call = instruction("call.rm32");

  deepStrictEqual(sub.opcode, [0x83]);
  deepStrictEqual(sub.modrm, { match: { reg: 5 } });
  deepStrictEqual(sub.operands, [
    { kind: "modrm.rm", type: "rm32" },
    { kind: "imm", width: 8, extension: "sign" }
  ]);

  deepStrictEqual(call.opcode, [0xff]);
  deepStrictEqual(call.modrm, { match: { reg: 2 } });
  deepStrictEqual(call.operands, [{ kind: "modrm.rm", type: "rm32" }]);
});

test("opcode-encoded register forms expand through opcode low bits", () => {
  const mov = instruction("mov.r32_imm32");
  const push = instruction("push.r32");
  const pop = instruction("pop.r32");

  deepStrictEqual(expandInstructionSpec(mov).map((entry) => entry.opcode), [
    [0xb8],
    [0xb9],
    [0xba],
    [0xbb],
    [0xbc],
    [0xbd],
    [0xbe],
    [0xbf]
  ]);
  deepStrictEqual(expandInstructionSpec(push).map((entry) => entry.opcode), [
    [0x50],
    [0x51],
    [0x52],
    [0x53],
    [0x54],
    [0x55],
    [0x56],
    [0x57]
  ]);
  deepStrictEqual(expandInstructionSpec(pop).map((entry) => entry.opcode), [
    [0x58],
    [0x59],
    [0x5a],
    [0x5b],
    [0x5c],
    [0x5d],
    [0x5e],
    [0x5f]
  ]);
});

test("ret imm16 records zero-extension and generic control semantics", () => {
  const spec = instruction("ret.imm16");

  deepStrictEqual(spec.opcode, [0xc2]);
  deepStrictEqual(spec.operands, [{ kind: "imm", width: 16, extension: "zero" }]);
  deepStrictEqual(spec.format, { syntax: "ret {0}" });

  const program = buildSir(spec.semantics as SemanticTemplate);
  strictEqual(program.at(-1)?.op, "jump");
});

test("jcc forms are concrete specs with condition-specific semantics", () => {
  const short = instruction("jne.rel8");
  const near = instruction("jne.rel32");

  deepStrictEqual(short.opcode, [0x75]);
  deepStrictEqual(short.operands, [{ kind: "rel", width: 8 }]);
  deepStrictEqual(short.format, { syntax: "jne {0}" });

  deepStrictEqual(near.opcode, [0x0f, 0x85]);
  deepStrictEqual(near.operands, [{ kind: "rel", width: 32 }]);
  deepStrictEqual(near.format, { syntax: "jne {0}" });

  const program = buildSir(short.semantics as SemanticTemplate);
  deepStrictEqual(program[0], { op: "condition", dst: { kind: "var", id: 0 }, cc: "NE" });
  strictEqual(program.at(-1)?.op, "conditionalJump");
});

function instruction(id: string): InstructionSpec {
  const spec = X86_32_CORE.instructions.find((entry) => entry.id === id);

  if (spec === undefined) {
    throw new Error(`missing instruction ${id}`);
  }

  return spec;
}
