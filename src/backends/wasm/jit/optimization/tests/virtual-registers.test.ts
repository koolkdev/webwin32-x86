import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { foldJitVirtualRegisters } from "#backends/wasm/jit/optimization/virtual-registers.js";
import { set32TargetRegs, startAddress } from "./helpers.js";

test("foldJitVirtualRegisters keeps transient register calculations virtual until exit", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], addEbxEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    movEaxZero,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 4);
  strictEqual(folded.folding.materializedSetCount, 2);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx"]);
});

test("foldJitVirtualRegisters materializes repeated expensive virtual reads", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const addEdxEax = ok(decodeBytes([0x01, 0xc2], addEbxEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], addEdxEax.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    addEdxEax,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 4);
  strictEqual(folded.folding.materializedSetCount, 3);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx", "edx"]);
});

test("foldJitVirtualRegisters keeps oversized expressions concrete", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xor1 = ok(decodeBytes([0x83, 0xf0, 0x01], movEaxEcx.nextEip));
  const xor2 = ok(decodeBytes([0x83, 0xf0, 0x02], xor1.nextEip));
  const xor3 = ok(decodeBytes([0x83, 0xf0, 0x03], xor2.nextEip));
  const xor4 = ok(decodeBytes([0x83, 0xf0, 0x04], xor3.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], xor4.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xor1,
    xor2,
    xor3,
    xor4,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 4);
  strictEqual(folded.folding.materializedSetCount, 0);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax"]);
});

test("foldJitVirtualRegisters folds virtual register values into indirect jump targets", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const jmpEax = ok(decodeBytes([0xff, 0xe0], xorEax.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    jmpEax
  ]));
  const jumpInstruction = folded.block.instructions.at(-1)!;
  const jumpIndex = jumpInstruction.ir.findIndex((op) => op.op === "jump");

  strictEqual(folded.folding.removedSetCount, 2);
  strictEqual(folded.folding.materializedSetCount, 1);
  deepStrictEqual(
    jumpInstruction.ir.slice(0, jumpIndex).map((op) => op.op),
    ["get32", "i32.xor", "set32"]
  );
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax"]);
});

test("foldJitVirtualRegisters folds virtual register values into effective addresses", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const leaEbx = ok(decodeBytes([0x8d, 0x58, 0x04], movEaxEcx.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], leaEbx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    leaEbx,
    movEaxZero,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 3);
  strictEqual(folded.folding.materializedSetCount, 2);
  strictEqual(folded.block.instructions[1]!.ir.some((op) => op.op === "address32"), false);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx"]);
});

test("foldJitVirtualRegisters materializes virtual registers for scaled effective addresses", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const leaEbx = ok(decodeBytes([0x8d, 0x1c, 0x45, 0x04, 0x00, 0x00, 0x00], movEaxEcx.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], leaEbx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    leaEbx,
    movEaxZero,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 2);
  strictEqual(folded.folding.materializedSetCount, 2);
  strictEqual(folded.block.instructions[1]!.ir.some((op) => op.op === "address32"), true);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx", "eax"]);
});

test("foldJitVirtualRegisters resumes after the last pre-instruction exit in an instruction", () => {
  const pushEax = ok(decodeBytes([0x50], startAddress));
  const trap = ok(decodeBytes([0xcd, 0x2e], pushEax.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([pushEax, trap]));

  strictEqual(folded.folding.removedSetCount, 1);
  strictEqual(folded.folding.materializedSetCount, 1);
  strictEqual(
    folded.block.instructions[0]!.ir.some((op) => op.op === "set32" && op.target.kind === "reg" && op.target.reg === "esp"),
    false
  );
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["esp"]);
});
