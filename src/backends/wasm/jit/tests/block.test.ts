import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { IR_ALU_FLAG_MASK } from "#x86/ir/passes/flag-analysis.js";
import { isIrTerminatorOp } from "#x86/ir/model/ops.js";
import type { IrOp, StorageRef } from "#x86/ir/model/types.js";
import { createCpuState } from "#x86/state/cpu-state.js";
import { stateOffset } from "#backends/wasm/abi.js";
import { wasmOpcode, wasmSectionId } from "#backends/wasm/encoder/types.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { buildJitIrBlock, encodeJitIrBlock } from "#backends/wasm/jit/block.js";
import { buildJitLoweringBlock } from "#backends/wasm/jit/lowering/lowering-block.js";
import { optimizeJitIrBlock } from "#backends/wasm/jit/optimization/optimize.js";
import { runJitIrBlock } from "./helpers.js";

const startAddress = 0x1000;
const preservedEflags = 0xffff_0000;
const zeroFlag = 1 << 6;
const addWraparoundEflags = 0x55;
const zeroResultEflags = 0x44;

test("buildJitIrBlock builds instruction-local IR bodies", () => {
  const first = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const second = ok(decodeBytes([0x83, 0xc0, 0x01], first.nextEip));
  const block = buildJitIrBlock([first, second]);
  const firstIr = block.instructions[0]!.ir;
  const secondIr = block.instructions[1]!.ir;
  const firstDefIds = firstIr.flatMap(irOpDstId);
  const secondDefIds = secondIr.flatMap(irOpDstId);

  strictEqual("ir" in block, false);
  strictEqual("operands" in block, false);
  strictEqual(block.instructions.length, 2);
  strictEqual(block.instructions[0]!.operands.length, first.operands.length);
  strictEqual(block.instructions[1]!.operands.length, second.operands.length);
  strictEqual(firstIr.filter((op) => op.op === "next").length, 1);
  strictEqual(secondIr.filter((op) => op.op === "next").length, 1);
  deepStrictEqual([...new Set(firstIr.flatMap(irOpOperandIndexes))].sort((a, b) => a - b), [0, 1]);
  deepStrictEqual([...new Set(secondIr.flatMap(irOpOperandIndexes))].sort((a, b) => a - b), [0, 1]);
  strictEqual(new Set(firstDefIds).size, firstDefIds.length);
  strictEqual(new Set(secondDefIds).size, secondDefIds.length);
  strictEqual(Math.min(...secondDefIds), 0);
});

test("JIT lowering preparation keeps instruction-local operand namespaces", () => {
  const first = ok(decodeBytes([0x01, 0xd8], startAddress));
  const second = ok(decodeBytes([0x01, 0xd1], first.nextEip));
  const loweringBlock = buildJitLoweringBlock(
    optimizeJitIrBlock(buildJitIrBlock([first, second]))
  );
  const firstIr = loweringBlock.instructions[0]!.ir;
  const secondIr = loweringBlock.instructions[1]!.ir;

  strictEqual("ir" in loweringBlock, false);
  strictEqual("operands" in loweringBlock, false);
  strictEqual(loweringBlock.instructions.length, 2);
  strictEqual(firstIr.filter(isIrTerminatorOp).length, 1);
  strictEqual(secondIr.filter(isIrTerminatorOp).length, 1);
  deepStrictEqual([...new Set(firstIr.flatMap(irOpOperandIndexes))].sort((a, b) => a - b), [0, 1]);
  deepStrictEqual([...new Set(secondIr.flatMap(irOpOperandIndexes))].sort((a, b) => a - b), [0, 1]);
});

test("buildJitIrBlock prunes flag producers overwritten inside the block", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], cmp.nextEip));
  const ir = loweringIr(buildJitIrBlock([cmp, add]));
  const flagSets = ir.filter((op) => op.op === "flags.set");

  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32"]);
});

test("buildJitIrBlock leaves condition materialization to JIT flag state", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const jz = ok(decodeBytes([0x74, 0x05], add.nextEip));
  const branchIr = loweringIr(buildJitIrBlock([add, jz]));
  const conditionIndex = branchIr.findIndex((op) => op.op === "aluFlags.condition");
  const conditionalJumpIndex = branchIr.findIndex((op) => op.op === "conditionalJump");

  strictEqual(branchIr.some((op) => op.op === "flags.materialize"), false);
  deepStrictEqual(branchIr[conditionalJumpIndex - 1], {
    op: "flags.boundary",
    mask: IR_ALU_FLAG_MASK
  });

  const trap = ok(decodeBytes([0xcd, 0x2e], add.nextEip));
  const exitIr = loweringIr(buildJitIrBlock([add, trap]));
  const hostTrapIndex = exitIr.findIndex((op) => op.op === "hostTrap");

  deepStrictEqual(exitIr[hostTrapIndex - 1], {
    op: "flags.boundary",
    mask: IR_ALU_FLAG_MASK
  });
});

test("buildJitIrBlock keeps earlier CF producer live across INC", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const inc = ok(decodeBytes([0x40], add.nextEip));
  const jc = ok(decodeBytes([0x72, 0x05], inc.nextEip));
  const ir = loweringIr(buildJitIrBlock([add, inc, jc]));
  const flagSets = ir.filter((op) => op.op === "flags.set");

  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32", "inc32"]);
  strictEqual(ir.some((op) => op.op === "flags.materialize"), false);
});

test("buildJitIrBlock keeps cmp and jcc condition IR instruction-local", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const je = ok(decodeBytes([0x74, 0x05], cmp.nextEip));
  const ir = loweringIr(buildJitIrBlock([cmp, je]));

  strictEqual(ir.some((op) => op.op === "flagProducer.condition"), false);
  strictEqual(ir.some((op) => op.op === "flags.materialize"), false);
});

test("buildJitIrBlock does not specialize incoming CF after INC", () => {
  const inc = ok(decodeBytes([0x40], startAddress));
  const jc = ok(decodeBytes([0x72, 0x05], inc.nextEip));
  const block = buildJitIrBlock([inc, jc]);
  const ir = loweringIr(block);

  strictEqual(ir.some((op) => op.op === "flagProducer.condition"), false);
  strictEqual(ir.some((op) => op.op === "flags.materialize"), false);
  deepStrictEqual(aluFlagMemoryAccessCounts(block), { loads: 1, stores: 1 });
});

test("buildJitIrBlock represents JIT flag exits as explicit IR boundaries", () => {
  const flagFreeIr = loweringIr(buildJitIrBlock([
    ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress)),
    ok(decodeBytes([0xbb, 0x02, 0x00, 0x00, 0x00], startAddress + 5)),
    ok(decodeBytes([0xcd, 0x2e], startAddress + 10))
  ]));
  const flagFreeTrapIndex = flagFreeIr.findIndex((op) => op.op === "hostTrap");

  deepStrictEqual(flagFreeIr[flagFreeTrapIndex - 1], {
    op: "flags.boundary",
    mask: IR_ALU_FLAG_MASK
  });

  const jzIr = loweringIr(buildJitIrBlock([ok(decodeBytes([0x74, 0x05], startAddress))]));
  const jzJumpIndex = jzIr.findIndex((op) => op.op === "conditionalJump");

  strictEqual(jzIr.some((op) => op.op === "flags.materialize"), false);
  deepStrictEqual(jzIr[jzJumpIndex - 1], {
    op: "flags.boundary",
    mask: IR_ALU_FLAG_MASK
  });
});

test("jit IR block lowering uses explicit flag boundaries for aluFlags memory traffic", () => {
  const flagFreeBlock = buildJitIrBlock([
    ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress)),
    ok(decodeBytes([0xbb, 0x02, 0x00, 0x00, 0x00], startAddress + 5)),
    ok(decodeBytes([0xcd, 0x2e], startAddress + 10))
  ]);
  const branchBlock = buildJitIrBlock([ok(decodeBytes([0x74, 0x05], startAddress))]);
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const addTrapBlock = buildJitIrBlock([add, ok(decodeBytes([0xcd, 0x2e], add.nextEip))]);

  deepStrictEqual(aluFlagMemoryAccessCounts(flagFreeBlock), { loads: 0, stores: 0 });
  deepStrictEqual(aluFlagMemoryAccessCounts(branchBlock), { loads: 1, stores: 0 });
  deepStrictEqual(stateMemoryLoads(branchBlock).slice(0, 2), [
    stateOffset.instructionCount,
    stateOffset.aluFlags
  ]);
  deepStrictEqual(aluFlagMemoryAccessCounts(addTrapBlock), { loads: 0, stores: 1 });
});

test("jit IR block lowers mov r32, imm32 with static operands", async () => {
  const result = await runJitIrBlock([0xb8, 0x78, 0x56, 0x34, 0x12], createCpuState({ eip: startAddress }));

  strictEqual(result.state.eax, 0x1234_5678);
  strictEqual(result.state.eip, startAddress + 5);
  strictEqual(result.state.instructionCount, 1);
  deepStrictEqual(result.exit, { exitReason: ExitReason.FALLTHROUGH, payload: startAddress + 5 });
});

test("jit IR block continues through fallthrough instructions until a control exit", async () => {
  const result = await runJitIrBlock(
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

test("jit IR block lowers memory mov with static effective addresses", async () => {
  const load = await runJitIrBlock(
    [0x8b, 0x43, 0x04],
    createCpuState({ ebx: 0x2000, eip: startAddress }),
    [{ address: 0x2004, bytes: [0x78, 0x56, 0x34, 0x12] }]
  );

  strictEqual(load.state.eax, 0x1234_5678);

  const store = await runJitIrBlock(
    [0x89, 0x43, 0x08],
    createCpuState({ eax: 0xaabb_ccdd, ebx: 0x2000, eip: startAddress })
  );

  strictEqual(store.guestView.getUint32(0x2008, true), 0xaabb_ccdd);

  const storeImmediate = await runJitIrBlock(
    [0xc7, 0x43, 0x0c, 0x78, 0x56, 0x34, 0x12],
    createCpuState({ ebx: 0x2000, eip: startAddress })
  );

  strictEqual(storeImmediate.guestView.getUint32(0x200c, true), 0x1234_5678);
});

test("jit IR block lowers leave", async () => {
  const result = await runJitIrBlock(
    [0xc9],
    createCpuState({ ebp: 0x20, esp: 0x100, eip: startAddress }),
    [{ address: 0x20, bytes: [0x78, 0x56, 0x34, 0x12] }]
  );

  strictEqual(result.state.ebp, 0x1234_5678);
  strictEqual(result.state.esp, 0x24);
  strictEqual(result.state.eip, startAddress + 1);
  strictEqual(result.state.instructionCount, 1);
});

test("jit IR block keeps deferred flags live after memory-store fault branch emission", async () => {
  const result = await runJitIrBlock([
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

test("jit IR block lowers add and materializes flags", async () => {
  const result = await runJitIrBlock([0x83, 0xc0, 0x01], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.eflags, (preservedEflags | addWraparoundEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 3);
  strictEqual(result.state.instructionCount, 1);
});

test("jit IR block lowers or and materializes logic flags", async () => {
  const result = await runJitIrBlock([0x0d, 0x00, 0x01, 0x00, 0x00], createCpuState({
    eax: 0x8000_0000,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0x8000_0100);
  strictEqual(result.state.eflags, (preservedEflags | 0x84) >>> 0);
  strictEqual(result.state.eip, startAddress + 5);
  strictEqual(result.state.instructionCount, 1);
});

test("jit IR block materializes the latest deferred flags on exit", async () => {
  const result = await runJitIrBlock([
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

test("jit IR block folds transient virtual register calculations", async () => {
  const result = await runJitIrBlock([
    0x89, 0xc8, // mov eax, ecx
    0x83, 0xf0, 0x02, // xor eax, 2
    0x01, 0xc3, // add ebx, eax
    0xb8, 0x00, 0x00, 0x00, 0x00, // mov eax, 0
    0xcd, 0x2e // int 0x2e
  ], createCpuState({
    eax: 0xaaaa_aaaa,
    ebx: 10,
    ecx: 5,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.ebx, 17);
  strictEqual(result.state.ecx, 5);
  strictEqual(result.state.eip, startAddress + 14);
  strictEqual(result.state.instructionCount, 5);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit IR block materializes virtual registers before memory fault exits", async () => {
  const load = 0x10000;
  const result = await runJitIrBlock([
    0x89, 0xc8, // mov eax, ecx
    0x8b, 0x15, 0x00, 0x00, 0x01, 0x00 // mov edx, [0x10000]
  ], createCpuState({
    eax: 0xaaaa_aaaa,
    ecx: 0x1234_5678,
    edx: 0xeeee_eeee,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0x1234_5678);
  strictEqual(result.state.ecx, 0x1234_5678);
  strictEqual(result.state.edx, 0xeeee_eeee);
  strictEqual(result.state.eip, startAddress + 2);
  strictEqual(result.state.instructionCount, 1);
  deepStrictEqual(result.exit, { exitReason: ExitReason.MEMORY_READ_FAULT, payload: load });
});

test("jit IR block preserves virtual register values before source clobbers", async () => {
  const result = await runJitIrBlock([
    0x89, 0xc8, // mov eax, ecx
    0xb9, 0x00, 0x00, 0x00, 0x00, // mov ecx, 0
    0x01, 0xc3, // add ebx, eax
    0xcd, 0x2e // int 0x2e
  ], createCpuState({
    eax: 0xaaaa_aaaa,
    ebx: 10,
    ecx: 7,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 7);
  strictEqual(result.state.ebx, 17);
  strictEqual(result.state.ecx, 0);
  strictEqual(result.state.eip, startAddress + 11);
  strictEqual(result.state.instructionCount, 4);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit IR block materializes repeated virtual register reads without changing results", async () => {
  const result = await runJitIrBlock([
    0x89, 0xc8, // mov eax, ecx
    0x83, 0xf0, 0x02, // xor eax, 2
    0x01, 0xc3, // add ebx, eax
    0x01, 0xc2, // add edx, eax
    0xcd, 0x2e // int 0x2e
  ], createCpuState({
    eax: 0xaaaa_aaaa,
    ebx: 10,
    ecx: 5,
    edx: 20,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 7);
  strictEqual(result.state.ebx, 17);
  strictEqual(result.state.ecx, 5);
  strictEqual(result.state.edx, 27);
  strictEqual(result.state.eip, startAddress + 11);
  strictEqual(result.state.instructionCount, 5);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit IR block preserves CF across INC partial flag writes", async () => {
  const result = await runJitIrBlock([
    0x83, 0xc0, 0x01, // add eax, 1
    0x40, // inc eax
    0x72, 0x05 // jc +5
  ], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 1);
  strictEqual(result.state.eflags, (preservedEflags | 0x01) >>> 0);
  strictEqual(result.state.eip, startAddress + 11);
  strictEqual(result.state.instructionCount, 3);
  deepStrictEqual(result.exit, { exitReason: ExitReason.BRANCH_TAKEN, payload: startAddress + 11 });
});

test("jit IR block branches on incoming CF after INC", async () => {
  const taken = await runJitIrBlock([
    0x40, // inc eax
    0x72, 0x05 // jc +5
  ], createCpuState({
    eax: 0,
    eflags: preservedEflags | 0x01,
    eip: startAddress
  }));
  const notTaken = await runJitIrBlock([
    0x40, // inc eax
    0x72, 0x05 // jc +5
  ], createCpuState({
    eax: 0,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(taken.state.eax, 1);
  strictEqual(taken.state.eflags, (preservedEflags | 0x01) >>> 0);
  strictEqual(taken.state.eip, startAddress + 8);
  strictEqual(taken.state.instructionCount, 2);
  deepStrictEqual(taken.exit, { exitReason: ExitReason.BRANCH_TAKEN, payload: startAddress + 8 });

  strictEqual(notTaken.state.eax, 1);
  strictEqual(notTaken.state.eflags, preservedEflags);
  strictEqual(notTaken.state.eip, startAddress + 3);
  strictEqual(notTaken.state.instructionCount, 2);
  deepStrictEqual(notTaken.exit, { exitReason: ExitReason.BRANCH_NOT_TAKEN, payload: startAddress + 3 });
});

test("jit IR block lowers cmp without writing operands", async () => {
  const result = await runJitIrBlock([0x39, 0xd8], createCpuState({
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

test("jit IR block handles specialized cmp condition branches", async () => {
  const takenCases = [
    { name: "JE", opcode: 0x74, eax: 5, ebx: 5 },
    { name: "JNE", opcode: 0x75, eax: 5, ebx: 6 },
    { name: "JB", opcode: 0x72, eax: 1, ebx: 2 },
    { name: "JAE", opcode: 0x73, eax: 2, ebx: 1 },
    { name: "JL", opcode: 0x7c, eax: 0xffff_ffff, ebx: 1 },
    { name: "JGE", opcode: 0x7d, eax: 1, ebx: 0xffff_ffff },
    { name: "JLE", opcode: 0x7e, eax: 0xffff_ffff, ebx: 1 },
    { name: "JG", opcode: 0x7f, eax: 1, ebx: 0xffff_ffff }
  ] as const;

  for (const testCase of takenCases) {
    const result = await runJitIrBlock([
      0x39, 0xd8, // cmp eax, ebx
      testCase.opcode, 0x05
    ], createCpuState({
      eax: testCase.eax,
      ebx: testCase.ebx,
      eip: startAddress
    }));

    strictEqual(result.state.eip, startAddress + 9, testCase.name);
    strictEqual(result.state.instructionCount, 2, testCase.name);
    deepStrictEqual(result.exit, { exitReason: ExitReason.BRANCH_TAKEN, payload: startAddress + 9 });
  }
});

test("jit IR block materializes deferred flags before condition consumers", async () => {
  const result = await runJitIrBlock([
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

test("jit IR block lowers conditional branches", async () => {
  const taken = await runJitIrBlock([0x75, 0x05], createCpuState({
    eip: startAddress,
    instructionCount: 10
  }));
  const notTaken = await runJitIrBlock([0x75, 0x05], createCpuState({
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

test("jit IR block materializes deferred flags on later fault exits", async () => {
  const result = await runJitIrBlock([
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

test("jit IR block keeps flags live across memory fault exits before later overwrites", async () => {
  const result = await runJitIrBlock([
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

function loweringIr(block: ReturnType<typeof buildJitIrBlock>): readonly IrOp[] {
  return buildJitLoweringBlock(optimizeJitIrBlock(block)).instructions.flatMap(
    (instruction) => instruction.ir
  );
}

function irOpDstId(op: IrOp): readonly number[] {
  switch (op.op) {
    case "get32":
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "aluFlags.condition":
    case "flagProducer.condition":
      return [op.dst.id];
    default:
      return [];
  }
}

function irOpOperandIndexes(op: IrOp): readonly number[] {
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

function aluFlagMemoryAccessCounts(block: ReturnType<typeof buildJitIrBlock>): Readonly<{ loads: number; stores: number }> {
  let loads = 0;
  let stores = 0;

  for (const access of memoryAccesses(extractOnlyFunctionBody(encodeJitIrBlock(block)))) {
    if (access.memoryIndex !== 0 || access.offset !== stateOffset.aluFlags) {
      continue;
    }

    if (access.opcode === wasmOpcode.i32Load) {
      loads += 1;
    } else if (access.opcode === wasmOpcode.i32Store) {
      stores += 1;
    }
  }

  return { loads, stores };
}

function stateMemoryLoads(block: ReturnType<typeof buildJitIrBlock>): readonly number[] {
  return memoryAccesses(extractOnlyFunctionBody(encodeJitIrBlock(block)))
    .filter((access) => access.memoryIndex === 0 && access.opcode === wasmOpcode.i32Load)
    .map((access) => access.offset);
}

type WasmMemoryAccess = Readonly<{
  opcode: number;
  memoryIndex: number;
  offset: number;
}>;

function memoryAccesses(functionBody: Uint8Array<ArrayBuffer>): readonly WasmMemoryAccess[] {
  const accesses: WasmMemoryAccess[] = [];
  let offset = skipLocalDeclarations(functionBody);

  while (offset < functionBody.length) {
    const opcode = requiredByte(functionBody, offset);

    offset += 1;

    switch (opcode) {
      case wasmOpcode.localGet:
      case wasmOpcode.localSet:
      case wasmOpcode.localTee:
      case wasmOpcode.br:
      case wasmOpcode.call:
      case wasmOpcode.returnCall:
      case wasmOpcode.memorySize:
        offset = readU32Leb128(functionBody, offset).nextOffset;
        break;
      case wasmOpcode.brTable: {
        const tableLength = readU32Leb128(functionBody, offset);

        offset = tableLength.nextOffset;

        for (let index = 0; index < tableLength.value; index += 1) {
          offset = readU32Leb128(functionBody, offset).nextOffset;
        }

        offset = readU32Leb128(functionBody, offset).nextOffset;
        break;
      }
      case wasmOpcode.block:
      case wasmOpcode.loop:
      case wasmOpcode.if:
        offset += 1;
        break;
      case wasmOpcode.i32Const:
      case wasmOpcode.i64Const:
        offset = skipLeb128(functionBody, offset);
        break;
      case wasmOpcode.i32Load:
      case wasmOpcode.i32Load8U:
      case wasmOpcode.i32Store: {
        const memory = readMemoryImmediate(functionBody, offset);

        offset = memory.nextOffset;
        accesses.push({
          opcode,
          memoryIndex: memory.memoryIndex,
          offset: memory.offset
        });
        break;
      }
      case wasmOpcode.else:
      case wasmOpcode.return:
      case wasmOpcode.i32Eqz:
      case wasmOpcode.i32LtU:
      case wasmOpcode.i32GtU:
      case wasmOpcode.i32Popcnt:
      case wasmOpcode.i32Add:
      case wasmOpcode.i32Sub:
      case wasmOpcode.i32And:
      case wasmOpcode.i32Or:
      case wasmOpcode.i32Xor:
      case wasmOpcode.i32Shl:
      case wasmOpcode.i32ShrU:
      case wasmOpcode.i64Or:
      case wasmOpcode.i64ExtendI32U:
      case wasmOpcode.end:
        break;
      default:
        throw new Error(`unsupported Wasm opcode in JIT block test: 0x${opcode.toString(16)}`);
    }
  }

  return accesses;
}

function extractOnlyFunctionBody(moduleBytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let offset = 8;

  while (offset < moduleBytes.length) {
    const sectionId = requiredByte(moduleBytes, offset);
    const sectionSize = readU32Leb128(moduleBytes, offset + 1);
    const sectionStart = sectionSize.nextOffset;
    const sectionEnd = sectionStart + sectionSize.value;

    if (sectionId === wasmSectionId.code) {
      const functionCount = readU32Leb128(moduleBytes, sectionStart);

      strictEqual(functionCount.value, 1);

      const bodySize = readU32Leb128(moduleBytes, functionCount.nextOffset);
      const bodyStart = bodySize.nextOffset;

      return moduleBytes.slice(bodyStart, bodyStart + bodySize.value);
    }

    offset = sectionEnd;
  }

  throw new Error("missing Wasm code section");
}

function skipLocalDeclarations(bytes: Uint8Array<ArrayBuffer>): number {
  const groupCount = readU32Leb128(bytes, 0);
  let offset = groupCount.nextOffset;

  for (let index = 0; index < groupCount.value; index += 1) {
    const groupSize = readU32Leb128(bytes, offset);

    offset = groupSize.nextOffset + 1;
  }

  return offset;
}

function readMemoryImmediate(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number
): Readonly<{ memoryIndex: number; offset: number; nextOffset: number }> {
  const align = readU32Leb128(bytes, offset);
  const hasMemoryIndex = (align.value & 0x40) !== 0;

  if (!hasMemoryIndex) {
    const memoryOffset = readU32Leb128(bytes, align.nextOffset);

    return { memoryIndex: 0, offset: memoryOffset.value, nextOffset: memoryOffset.nextOffset };
  }

  const memoryIndex = readU32Leb128(bytes, align.nextOffset);
  const memoryOffset = readU32Leb128(bytes, memoryIndex.nextOffset);

  return { memoryIndex: memoryIndex.value, offset: memoryOffset.value, nextOffset: memoryOffset.nextOffset };
}

function skipLeb128(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  while ((requiredByte(bytes, offset) & 0x80) !== 0) {
    offset += 1;
  }

  return offset + 1;
}

function readU32Leb128(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number
): Readonly<{ value: number; nextOffset: number }> {
  let value = 0;
  let shift = 0;

  while (true) {
    const byte = requiredByte(bytes, offset);

    value |= (byte & 0x7f) << shift;
    offset += 1;

    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, nextOffset: offset };
    }

    shift += 7;
  }
}

function requiredByte(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  const byte = bytes[offset];

  if (byte === undefined) {
    throw new Error(`unexpected end of Wasm bytes at offset ${offset}`);
  }

  return byte;
}
