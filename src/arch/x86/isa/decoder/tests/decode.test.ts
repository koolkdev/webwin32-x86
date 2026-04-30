import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeIsaInstruction } from "../decode.js";
import { bytes, ok, startAddress } from "./helpers.js";

test("decodes opcode-encoded register and imm32 operands", () => {
  const decoded = ok(decodeIsaInstruction(bytes([0xbb, 0x78, 0x56, 0x34, 0x12]), 0, startAddress));

  strictEqual(decoded.spec.id, "mov.r32_imm32");
  strictEqual(decoded.spec.format.syntax, "mov {0}, {1}");
  strictEqual(decoded.length, 5);
  strictEqual(decoded.nextEip, startAddress + 5);
  deepStrictEqual(decoded.raw, [0xbb, 0x78, 0x56, 0x34, 0x12]);
  deepStrictEqual(decoded.operands, [
    { kind: "reg32", reg: "ebx" },
    { kind: "imm32", value: 0x1234_5678, encodedWidth: 32 }
  ]);
});

test("decodes slash-r register/register operands positionally", () => {
  // 8B C3: MOV eax, ebx
  const mov = ok(decodeIsaInstruction(bytes([0x8b, 0xc3]), 0, startAddress));
  // 89 C3: MOV ebx, eax
  const reverse = ok(decodeIsaInstruction(bytes([0x89, 0xc3]), 0, startAddress));

  strictEqual(mov.spec.id, "mov.r32_rm32");
  strictEqual(mov.spec.format.syntax, "mov {0}, {1}");
  deepStrictEqual(mov.operands, [
    { kind: "reg32", reg: "eax" },
    { kind: "reg32", reg: "ebx" }
  ]);

  strictEqual(reverse.spec.id, "mov.rm32_r32");
  strictEqual(reverse.spec.format.syntax, "mov {0}, {1}");
  deepStrictEqual(reverse.operands, [
    { kind: "reg32", reg: "ebx" },
    { kind: "reg32", reg: "eax" }
  ]);
});

test("uses ModRM match fields for slash-digit groups", () => {
  // 83 /5 ib: SUB r/m32, sign-extended imm8
  const sub = ok(decodeIsaInstruction(bytes([0x83, 0xeb, 0xff]), 0, startAddress));
  // 81 /6 id: XOR r/m32, imm32
  const xor = ok(decodeIsaInstruction(bytes([0x81, 0xf3, 0x78, 0x56, 0x34, 0x12]), 0, startAddress));

  strictEqual(sub.spec.id, "sub.rm32_imm8");
  strictEqual(sub.spec.format.syntax, "sub {0}, {1}");
  deepStrictEqual(sub.operands, [
    { kind: "reg32", reg: "ebx" },
    { kind: "imm32", value: 0xffff_ffff, encodedWidth: 8, extension: "sign" }
  ]);

  strictEqual(xor.spec.id, "xor.rm32_imm32");
  strictEqual(xor.spec.format.syntax, "xor {0}, {1}");
  deepStrictEqual(xor.operands, [
    { kind: "reg32", reg: "ebx" },
    { kind: "imm32", value: 0x1234_5678, encodedWidth: 32 }
  ]);
});

test("rejects unregistered grouped opcodes after ModRM.reg dispatch", () => {
  // 83 /1 ib is not registered in the current ISA subset.
  const decoded = decodeIsaInstruction(bytes([0x83, 0xc8, 0x01]), 0, startAddress);

  strictEqual(decoded.kind, "unsupported");
  if (decoded.kind === "unsupported") {
    strictEqual(decoded.length, 2);
    deepStrictEqual(decoded.raw, [0x83, 0xc8]);
    strictEqual(decoded.unsupportedByte, 0x83);
  }
});

test("decodes direct relative targets as absolute target operands", () => {
  const jmp8 = ok(decodeIsaInstruction(bytes([0xeb, 0xfe]), 0, startAddress));
  const jmp32 = ok(decodeIsaInstruction(bytes([0xe9, 0xfb, 0xff, 0xff, 0xff]), 0, startAddress));

  strictEqual(jmp8.spec.id, "jmp.rel8");
  strictEqual(jmp8.spec.format.syntax, "jmp {0}");
  strictEqual(jmp8.nextEip, startAddress + 2);
  deepStrictEqual(jmp8.operands, [
    { kind: "relTarget", width: 8, displacement: -2, target: startAddress }
  ]);

  strictEqual(jmp32.spec.id, "jmp.rel32");
  strictEqual(jmp32.spec.format.syntax, "jmp {0}");
  strictEqual(jmp32.nextEip, startAddress + 5);
  deepStrictEqual(jmp32.operands, [
    { kind: "relTarget", width: 32, displacement: -5, target: startAddress }
  ]);
});

test("decodes concrete jcc rel8 and rel32 forms", () => {
  const rel8 = ok(decodeIsaInstruction(bytes([0x75, 0x05]), 0, startAddress));
  const rel32 = ok(decodeIsaInstruction(bytes([0x0f, 0x85, 0xfa, 0xff, 0xff, 0xff]), 0, startAddress));

  strictEqual(rel8.spec.id, "jne.rel8");
  strictEqual(rel8.spec.format.syntax, "jne {0}");
  deepStrictEqual(rel8.operands, [
    { kind: "relTarget", width: 8, displacement: 5, target: startAddress + 7 }
  ]);

  strictEqual(rel32.spec.id, "jne.rel32");
  strictEqual(rel32.spec.format.syntax, "jne {0}");
  deepStrictEqual(rel32.operands, [
    { kind: "relTarget", width: 32, displacement: -6, target: startAddress }
  ]);
});

test("decodes nop and int imm8 forms", () => {
  const nop = ok(decodeIsaInstruction(bytes([0x90]), 0, startAddress));
  const trap = ok(decodeIsaInstruction(bytes([0xcd, 0x2e]), 0, startAddress));

  strictEqual(nop.spec.id, "nop.near");
  strictEqual(nop.spec.format.syntax, "nop");
  strictEqual(nop.length, 1);
  deepStrictEqual(nop.operands, []);

  strictEqual(trap.spec.id, "int.imm8");
  strictEqual(trap.spec.format.syntax, "int {0}");
  strictEqual(trap.length, 2);
  deepStrictEqual(trap.operands, [
    { kind: "imm32", value: 0x2e, encodedWidth: 8 }
  ]);
});

test("decodes ModRM memory operands with displacement", () => {
  // 8B 43 04: MOV eax, [ebx + 4]
  const decoded = ok(decodeIsaInstruction(bytes([0x8b, 0x43, 0x04]), 0, startAddress));

  strictEqual(decoded.spec.id, "mov.r32_rm32");
  strictEqual(decoded.spec.format.syntax, "mov {0}, {1}");
  deepStrictEqual(decoded.operands, [
    { kind: "reg32", reg: "eax" },
    { kind: "mem32", base: "ebx", scale: 1, disp: 4 }
  ]);
});

test("rejects address-only m32 forms when ModRM encodes a register", () => {
  // 8D C3: LEA eax, ebx is invalid because LEA requires memory/address form.
  const decoded = decodeIsaInstruction(bytes([0x8d, 0xc3]), 0, startAddress);

  strictEqual(decoded.kind, "unsupported");
  if (decoded.kind === "unsupported") {
    strictEqual(decoded.length, 2);
    deepStrictEqual(decoded.raw, [0x8d, 0xc3]);
    strictEqual(decoded.unsupportedByte, 0x8d);
  }
});

test("reports unsupported opcode bytes", () => {
  const decoded = decodeIsaInstruction(bytes([0x62]), 0, startAddress);

  strictEqual(decoded.kind, "unsupported");
  if (decoded.kind === "unsupported") {
    strictEqual(decoded.length, 1);
    deepStrictEqual(decoded.raw, [0x62]);
    strictEqual(decoded.unsupportedByte, 0x62);
  }
});
