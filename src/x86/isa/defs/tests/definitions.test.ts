import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildIr } from "#x86/ir/build/builder.js";
import type { SemanticTemplate } from "#x86/ir/model/types.js";
import { X86_32_CORE } from "#x86/isa/index.js";
import { expandInstructionSpec } from "#x86/isa/schema/builders.js";
import type { InstructionSpec } from "#x86/isa/schema/types.js";

test("x86-32 core registers the initial instruction surface", () => {
  strictEqual(X86_32_CORE.name, "x86-32-core");
  strictEqual(X86_32_CORE.instructions.length, 189);

  const ids = X86_32_CORE.instructions.map((spec) => spec.id);

  for (const id of [
    "mov.r32_rm32",
    "mov.r8_rm8",
    "mov.r16_rm16",
    "mov.r8_imm8",
    "mov.r16_imm16",
    "nop.near",
    "nop.operand_size_override",
    "nop.rm16",
    "nop.rm32",
    "mov.rm32_r32",
    "mov.r32_imm32",
    "mov.rm32_imm32",
    "movzx.r16_rm8",
    "movzx.r32_rm8",
    "movzx.r32_rm16",
    "movsx.r16_rm8",
    "movsx.r32_rm8",
    "movsx.r32_rm16",
    "cmove.r32_rm32",
    "lea.r16_m16",
    "lea.r32_m32",
    "add.rm8_r8",
    "add.rm16_imm8",
    "add.ax_imm16",
    "add.rm32_imm8",
    "or.rm32_imm8",
    "and.rm32_imm8",
    "sub.rm32_imm8",
    "xor.eax_imm32",
    "inc.r32",
    "inc.rm8",
    "inc.rm16",
    "inc.rm32",
    "dec.r32",
    "dec.rm8",
    "dec.rm16",
    "dec.rm32",
    "cmp.rm32_imm8",
    "cmp.rm16_imm16",
    "test.al_imm8",
    "test.rm32_imm32",
    "push.r32",
    "pop.r32",
    "leave.near",
    "jmp.rel8",
    "call.rm32",
    "ret.near",
    "ret.imm16",
    "int.imm8",
    "cmovne.r32_rm32",
    "jne.rel8",
    "jne.rel32"
  ]) {
    strictEqual(ids.includes(id), true, `missing ${id}`);
  }
});

test("operand-size prefixed nop is a temporary alias form", () => {
  const spec = instruction("nop.operand_size_override");

  deepStrictEqual(spec.opcode, [0x90]);
  deepStrictEqual(spec.prefixes, { operandSize: "override" });
  strictEqual(spec.operands, undefined);
  deepStrictEqual(spec.format, { syntax: "nop" });
});

test("multi-byte nop forms use slash-zero ModRM operands without side effects", () => {
  const near = instruction("nop.rm32");
  const operandSize = instruction("nop.rm16");

  deepStrictEqual(near.opcode, [0x0f, 0x1f]);
  deepStrictEqual(near.modrm, { match: { reg: 0 } });
  deepStrictEqual(near.operands, [{ kind: "modrm.rm", type: "rm32" }]);
  deepStrictEqual(near.format, { syntax: "nop {0}" });
  deepStrictEqual(buildIr(near.semantics as SemanticTemplate), [{ op: "next" }]);

  deepStrictEqual(operandSize.prefixes, { operandSize: "override" });
  deepStrictEqual(operandSize.operands, [{ kind: "modrm.rm", type: "rm16" }]);
});

test("cmovcc forms are concrete specs with conditional-write semantics", () => {
  const spec = instruction("cmove.r32_rm32");

  deepStrictEqual(spec.opcode, [0x0f, 0x44]);
  deepStrictEqual(spec.operands, [
    { kind: "modrm.reg", type: "r32" },
    { kind: "modrm.rm", type: "rm32" }
  ]);
  deepStrictEqual(spec.format, { syntax: "cmove {0}, {1}" });

  const program = buildIr(spec.semantics as SemanticTemplate);

  deepStrictEqual(program[1], { op: "aluFlags.condition", dst: { kind: "var", id: 1 }, cc: "E" });
  deepStrictEqual(program[2], {
    op: "set.if",
    condition: { kind: "var", id: 1 },
    target: { kind: "operand", index: 0 },
    value: { kind: "var", id: 0 },
    accessWidth: 32
  });
  strictEqual(program.at(-1)?.op, "next");
});

test("leave is a no-operand stack frame instruction", () => {
  const spec = instruction("leave.near");

  deepStrictEqual(spec.opcode, [0xc9]);
  strictEqual(spec.operands, undefined);
  deepStrictEqual(spec.format, { syntax: "leave" });
});

test("slash-r forms use ModRM operands without an explicit ModRM match", () => {
  const spec = instruction("mov.r32_rm32");

  deepStrictEqual(spec.opcode, [0x8b]);
  strictEqual(spec.modrm, undefined);
  deepStrictEqual(spec.operands, [
    { kind: "modrm.reg", type: "r32" },
    { kind: "modrm.rm", type: "rm32" }
  ]);
  deepStrictEqual(spec.format, { syntax: "mov {0}, {1}" });
});

test("group opcode forms use modrm.match.reg for Intel slash-digit notation", () => {
  const or = instruction("or.rm32_imm8");
  const and = instruction("and.rm32_imm32");
  const sub = instruction("sub.rm32_imm8");
  const call = instruction("call.rm32");

  deepStrictEqual(or.opcode, [0x83]);
  deepStrictEqual(or.modrm, { match: { reg: 1 } });
  deepStrictEqual(or.operands, [
    { kind: "modrm.rm", type: "rm32" },
    { kind: "imm", width: 8, semanticWidth: 32, extension: "sign" }
  ]);

  deepStrictEqual(and.opcode, [0x81]);
  deepStrictEqual(and.modrm, { match: { reg: 4 } });
  deepStrictEqual(and.operands, [
    { kind: "modrm.rm", type: "rm32" },
    { kind: "imm", width: 32 }
  ]);

  deepStrictEqual(sub.opcode, [0x83]);
  deepStrictEqual(sub.modrm, { match: { reg: 5 } });
  deepStrictEqual(sub.operands, [
    { kind: "modrm.rm", type: "rm32" },
    { kind: "imm", width: 8, semanticWidth: 32, extension: "sign" }
  ]);

  deepStrictEqual(call.opcode, [0xff]);
  deepStrictEqual(call.modrm, { match: { reg: 2 } });
  deepStrictEqual(call.operands, [{ kind: "modrm.rm", type: "rm32" }]);
});

test("width-specific decode forms record operand-size metadata", () => {
  const mov8 = instruction("mov.r8_rm8");
  const mov16 = instruction("mov.r16_rm16");
  const movzx16 = instruction("movzx.r16_rm8");
  const movsx16 = instruction("movsx.r16_rm8");
  const lea16 = instruction("lea.r16_m16");
  const add8 = instruction("add.rm8_r8");
  const cmp16 = instruction("cmp.rm16_imm16");

  deepStrictEqual(mov8.operands, [
    { kind: "modrm.reg", type: "r8" },
    { kind: "modrm.rm", type: "rm8" }
  ]);

  deepStrictEqual(mov16.prefixes, { operandSize: "override" });
  deepStrictEqual(mov16.operands, [
    { kind: "modrm.reg", type: "r16" },
    { kind: "modrm.rm", type: "rm16" }
  ]);

  deepStrictEqual(movzx16.prefixes, { operandSize: "override" });
  deepStrictEqual(movzx16.operands, [
    { kind: "modrm.reg", type: "r16" },
    { kind: "modrm.rm", type: "rm8" }
  ]);

  deepStrictEqual(movsx16.prefixes, { operandSize: "override" });
  deepStrictEqual(movsx16.operands, [
    { kind: "modrm.reg", type: "r16" },
    { kind: "modrm.rm", type: "rm8" }
  ]);

  deepStrictEqual(lea16.prefixes, { operandSize: "override" });
  deepStrictEqual(lea16.operands, [
    { kind: "modrm.reg", type: "r16" },
    { kind: "modrm.rm", type: "m16" }
  ]);

  deepStrictEqual(add8.operands, [
    { kind: "modrm.rm", type: "rm8" },
    { kind: "modrm.reg", type: "r8" }
  ]);

  deepStrictEqual(cmp16.prefixes, { operandSize: "override" });
  deepStrictEqual(cmp16.operands, [
    { kind: "modrm.rm", type: "rm16" },
    { kind: "imm", width: 16 }
  ]);
});

test("mov r/m32, imm32 uses C7 slash-zero form", () => {
  const spec = instruction("mov.rm32_imm32");

  deepStrictEqual(spec.opcode, [0xc7]);
  deepStrictEqual(spec.modrm, { match: { reg: 0 } });
  deepStrictEqual(spec.operands, [
    { kind: "modrm.rm", type: "rm32" },
    { kind: "imm", width: 32 }
  ]);
});

test("extension move semantics are flagless and encode source and destination widths", () => {
  const movzx = buildIr(instruction("movzx.r32_rm8").semantics as SemanticTemplate);
  const movsx = buildIr(instruction("movsx.r16_rm8").semantics as SemanticTemplate);

  deepStrictEqual(movzx, [
    { op: "get", dst: { kind: "var", id: 0 }, source: { kind: "operand", index: 1 }, accessWidth: 8 },
    {
      op: "set",
      target: { kind: "operand", index: 0 },
      value: { kind: "var", id: 0 },
      accessWidth: 32
    },
    { op: "next" }
  ]);
  deepStrictEqual(movsx, [
    { op: "get", dst: { kind: "var", id: 0 }, source: { kind: "operand", index: 1 }, accessWidth: 8, signed: true },
    {
      op: "set",
      target: { kind: "operand", index: 0 },
      value: { kind: "var", id: 0 },
      accessWidth: 16
    },
    { op: "next" }
  ]);
  strictEqual(movzx.some((op) => op.op.startsWith("flags.")), false);
  strictEqual(movsx.some((op) => op.op.startsWith("flags.")), false);
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

test("ret imm16 records unsigned immediate and generic control semantics", () => {
  const spec = instruction("ret.imm16");

  deepStrictEqual(spec.opcode, [0xc2]);
  deepStrictEqual(spec.operands, [{ kind: "imm", width: 16 }]);
  deepStrictEqual(spec.format, { syntax: "ret {0}" });

  const program = buildIr(spec.semantics as SemanticTemplate);
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

  const program = buildIr(short.semantics as SemanticTemplate);
  deepStrictEqual(program[0], { op: "aluFlags.condition", dst: { kind: "var", id: 0 }, cc: "NE" });
  strictEqual(program.at(-1)?.op, "conditionalJump");
});

function instruction(id: string): InstructionSpec {
  const spec = X86_32_CORE.instructions.find((entry) => entry.id === id);

  if (spec === undefined) {
    throw new Error(`missing instruction ${id}`);
  }

  return spec;
}
