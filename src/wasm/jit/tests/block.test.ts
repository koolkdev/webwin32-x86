import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "../../../arch/x86/isa/decoder/tests/helpers.js";
import { SIR_ARITHMETIC_FLAG_MASK, SIR_FLAG_MASKS } from "../../../arch/x86/sir/flag-analysis.js";
import type { SirOp, StorageRef } from "../../../arch/x86/sir/types.js";
import { createCpuState } from "../../../core/state/cpu-state.js";
import { ExitReason } from "../../exit.js";
import { buildJitSirBlock } from "../block.js";
import { runJitSirBlock } from "./helpers.js";

const startAddress = 0x1000;
const preservedEflags = 0xffff_0000;
const zeroFlag = 1 << 6;
const addWraparoundEflags = 0x55;
const zeroResultEflags = 0x44;

test("buildJitSirBlock builds one SIR program with a shared var namespace", () => {
  const first = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const second = ok(decodeBytes([0x83, 0xc0, 0x01], first.nextEip));
  const block = buildJitSirBlock([first, second]);
  const firstRange = block.sir.slice(block.instructions[0]!.opStart, block.instructions[0]!.opEnd);
  const secondRange = block.sir.slice(block.instructions[1]!.opStart, block.instructions[1]!.opEnd);
  const defIds = block.sir.flatMap(sirOpDstId);
  const secondOperandIndexes = new Set(secondRange.flatMap(sirOpOperandIndexes));

  strictEqual("sir" in block.instructions[0]!, false);
  strictEqual(block.instructions.length, 2);
  strictEqual(block.operands.length, first.operands.length + second.operands.length);
  strictEqual(block.sir.filter((op) => op.op === "next").length, 2);
  strictEqual(firstRange.at(-1)?.op, "next");
  strictEqual(secondRange.at(-1)?.op, "next");
  strictEqual(Math.min(...secondOperandIndexes), first.operands.length);
  strictEqual(new Set(defIds).size, defIds.length);
});

test("buildJitSirBlock prunes flag producers overwritten inside the block", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], cmp.nextEip));
  const block = buildJitSirBlock([cmp, add]);
  const flagSets = block.sir.filter((op) => op.op === "flags.set");

  strictEqual(flagSets.length, 1);
  deepStrictEqual(flagSets[0], {
    op: "flags.set",
    producer: "add32",
    inputs: {
      left: { kind: "var", id: 3 },
      right: { kind: "var", id: 4 },
      result: { kind: "var", id: 5 }
    }
  });
  strictEqual(block.instructions[0]!.opEnd, block.instructions[1]!.opStart);
});

test("buildJitSirBlock inserts explicit flag materialization before consumers and exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const jz = ok(decodeBytes([0x74, 0x05], add.nextEip));
  const branchBlock = buildJitSirBlock([add, jz]);
  const conditionIndex = branchBlock.sir.findIndex((op) => op.op === "condition");

  deepStrictEqual(branchBlock.sir[conditionIndex - 1], {
    op: "flags.materialize",
    mask: SIR_FLAG_MASKS.ZF
  });

  const trap = ok(decodeBytes([0xcd, 0x2e], add.nextEip));
  const exitBlock = buildJitSirBlock([add, trap]);
  const hostTrapIndex = exitBlock.sir.findIndex((op) => op.op === "hostTrap");

  deepStrictEqual(exitBlock.sir[hostTrapIndex - 1], {
    op: "flags.materialize",
    mask: SIR_ARITHMETIC_FLAG_MASK
  });
});

test("jit SIR block lowers mov r32, imm32 with static operands", async () => {
  const result = await runJitSirBlock([0xb8, 0x78, 0x56, 0x34, 0x12], createCpuState({ eip: startAddress }));

  strictEqual(result.state.eax, 0x1234_5678);
  strictEqual(result.state.eip, startAddress + 5);
  strictEqual(result.state.instructionCount, 1);
  deepStrictEqual(result.exit, { exitReason: ExitReason.FALLTHROUGH, payload: startAddress + 5 });
});

test("jit SIR block continues through fallthrough instructions until a control exit", async () => {
  const result = await runJitSirBlock(
    [
      0xb8, 0x01, 0x00, 0x00, 0x00, // mov eax, 1
      0x83, 0xc0, 0x01, // add eax, 1
      0x83, 0xc0, 0x01, // add eax, 1
      0xcd, 0x2e // int 0x2e
    ],
    createCpuState({ eip: startAddress })
  );

  strictEqual(result.state.eax, 3);
  strictEqual(result.state.eip, startAddress + 13);
  strictEqual(result.state.instructionCount, 4);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit SIR block lowers memory mov with static effective addresses", async () => {
  const load = await runJitSirBlock(
    [0x8b, 0x43, 0x04],
    createCpuState({ ebx: 0x2000, eip: startAddress }),
    [{ address: 0x2004, bytes: [0x78, 0x56, 0x34, 0x12] }]
  );

  strictEqual(load.state.eax, 0x1234_5678);

  const store = await runJitSirBlock(
    [0x89, 0x43, 0x08],
    createCpuState({ eax: 0xaabb_ccdd, ebx: 0x2000, eip: startAddress })
  );

  strictEqual(store.guestView.getUint32(0x2008, true), 0xaabb_ccdd);
});

test("jit SIR block keeps deferred flags live after memory-store fault branch emission", async () => {
  const result = await runJitSirBlock([
    0x01, 0x18, // add [eax], ebx
    0xcd, 0x2e // int 0x2e
  ], createCpuState({
    eax: 0x20,
    ebx: 2,
    eip: startAddress
  }), [{ address: 0x20, bytes: [1, 0, 0, 0] }]);

  strictEqual(result.guestView.getUint32(0x20, true), 3);
  strictEqual(result.state.eflags, 0x04);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit SIR block lowers add and materializes flags", async () => {
  const result = await runJitSirBlock([0x83, 0xc0, 0x01], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.eflags, (preservedEflags | addWraparoundEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 3);
  strictEqual(result.state.instructionCount, 1);
});

test("jit SIR block materializes the latest deferred flags on exit", async () => {
  const result = await runJitSirBlock([
    0x83, 0xc0, 0x01, // add eax, 1
    0x83, 0xc0, 0x01, // add eax, 1
    0xcd, 0x2e // int 0x2e
  ], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 1);
  strictEqual(result.state.eflags, preservedEflags);
  strictEqual(result.state.eip, startAddress + 8);
  strictEqual(result.state.instructionCount, 3);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit SIR block lowers cmp without writing operands", async () => {
  const result = await runJitSirBlock([0x39, 0xd8], createCpuState({
    eax: 5,
    ebx: 5,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 5);
  strictEqual(result.state.ebx, 5);
  strictEqual(result.state.eflags, (preservedEflags | zeroResultEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 2);
  strictEqual(result.state.instructionCount, 1);
});

test("jit SIR block materializes deferred flags before condition consumers", async () => {
  const result = await runJitSirBlock([
    0x83, 0xc0, 0x01, // add eax, 1
    0x74, 0x05 // jz +5
  ], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.eflags, (preservedEflags | addWraparoundEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 10);
  strictEqual(result.state.instructionCount, 2);
  deepStrictEqual(result.exit, { exitReason: ExitReason.BRANCH_TAKEN, payload: startAddress + 10 });
});

test("jit SIR block lowers conditional branches", async () => {
  const taken = await runJitSirBlock([0x75, 0x05], createCpuState({
    eip: startAddress,
    instructionCount: 10
  }));
  const notTaken = await runJitSirBlock([0x75, 0x05], createCpuState({
    eip: startAddress,
    eflags: zeroFlag,
    instructionCount: 10
  }));

  deepStrictEqual(taken.exit, { exitReason: ExitReason.BRANCH_TAKEN, payload: startAddress + 7 });
  strictEqual(taken.state.eip, startAddress + 7);
  strictEqual(taken.state.instructionCount, 11);
  deepStrictEqual(notTaken.exit, { exitReason: ExitReason.BRANCH_NOT_TAKEN, payload: startAddress + 2 });
  strictEqual(notTaken.state.eip, startAddress + 2);
  strictEqual(notTaken.state.instructionCount, 11);
});

test("jit SIR block materializes deferred flags on later fault exits", async () => {
  const result = await runJitSirBlock([
    0x83, 0xc0, 0x01, // add eax, 1
    0x8b, 0x05, 0x00, 0x00, 0x01, 0x00 // mov eax, [0x10000]
  ], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.eflags, (preservedEflags | addWraparoundEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 3);
  strictEqual(result.state.instructionCount, 1);
  deepStrictEqual(result.exit, { exitReason: ExitReason.MEMORY_READ_FAULT, payload: 0x10000 });
});

test("jit SIR block keeps flags live across memory fault exits before later overwrites", async () => {
  const result = await runJitSirBlock([
    0x83, 0xc0, 0x01, // add eax, 1
    0x8b, 0x05, 0x00, 0x00, 0x01, 0x00, // mov eax, [0x10000]
    0x83, 0xc0, 0x01 // add eax, 1
  ], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.eflags, (preservedEflags | addWraparoundEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 3);
  strictEqual(result.state.instructionCount, 1);
  deepStrictEqual(result.exit, { exitReason: ExitReason.MEMORY_READ_FAULT, payload: 0x10000 });
});

function sirOpDstId(op: SirOp): readonly number[] {
  switch (op.op) {
    case "get32":
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.and":
    case "condition":
      return [op.dst.id];
    default:
      return [];
  }
}

function sirOpOperandIndexes(op: SirOp): readonly number[] {
  switch (op.op) {
    case "get32":
      return storageOperandIndexes(op.source);
    case "set32":
      return storageOperandIndexes(op.target);
    case "address32":
      return [op.operand.index];
    default:
      return [];
  }
}

function storageOperandIndexes(storage: StorageRef): readonly number[] {
  switch (storage.kind) {
    case "operand":
      return [storage.index];
    case "mem":
      return [];
    case "reg":
      return [];
  }
}
