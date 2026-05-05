import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "#x86/state/cpu-state.js";
import type { RegisterAlias } from "#x86/isa/types.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmOpcode } from "#backends/wasm/encoder/types.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { createJitReg32State } from "#backends/wasm/jit/state/register-state.js";
import { emptyRegValueState, recordPartialValue } from "#backends/wasm/jit/state/register-lanes.js";
import { planRegisterExitStore } from "#backends/wasm/jit/state/register-store-plan.js";
import { wasmBodyOpcodes } from "#backends/wasm/tests/body-opcodes.js";
import { runJitIrBlock } from "./helpers.js";

const startAddress = 0x1000;
const al: RegisterAlias = { name: "al", base: "eax", bitOffset: 0, width: 8 };
const ah: RegisterAlias = { name: "ah", base: "eax", bitOffset: 8, width: 8 };
const bl: RegisterAlias = { name: "bl", base: "ebx", bitOffset: 0, width: 8 };
const ax: RegisterAlias = { name: "ax", base: "eax", bitOffset: 0, width: 16 };

test("jit register state writes register-only instructions to committed locals", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSet("eax", () => {
    body.i32Const(1);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSet("eax", () => {
    body.i32Const(2);
  });
  regs.commitPending();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.localSet), 2);
});

test("jit register state stages writes when pre-instruction exits need committed locals", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSet("eax", () => {
    body.i32Const(1);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: true });
  regs.emitSet("eax", () => {
    body.i32Const(2);
  });
  regs.commitPending();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.localSet), 2);
});

test("jit register state returns to committed writes after pre-instruction exits", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: true });
  regs.emitSet("eax", () => {
    body.i32Const(1);
  });
  regs.commitPending();
  regs.emitSet("eax", () => {
    body.i32Const(2);
  });
  regs.commitPending();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.localSet), 2);
});

test("jit register state feeds later instructions from committed register locals", async () => {
  const result = await runJitIrBlock(
    [
      0xb8, 0x23, 0x01, 0x00, 0x00, // mov eax, 0x123
      0x89, 0xc3, // mov ebx, eax
      0x83, 0xc3, 0x01, // add ebx, 1
      0xcd, 0x2e // int 0x2e
    ],
    createCpuState({
      eax: 0xffff_ffff,
      ebx: 0xeeee_eeee,
      eip: startAddress,
      instructionCount: 20
    })
  );

  strictEqual(result.state.eax, 0x123);
  strictEqual(result.state.ebx, 0x124);
  strictEqual(result.state.instructionCount, 24);
  strictEqual(result.state.eip, startAddress + 12);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit register state reads known partial lanes without loading the full register", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(al, () => {
    body.i32Const(0x44);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitGetAlias(al);
  regs.commitPending();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.i32Load), 0);
});

test("jit register state materializes full registers when a wider read needs unknown lanes", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(al, () => {
    body.i32Const(0x44);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitGetAlias(ax);
  regs.commitPending();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.i32Load), 1);
});

test("jit register state materializes full registers after partial writes when full reads need unknown lanes", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(al, () => {
    body.i32Const(0x44);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitGet("eax");
  regs.commitPending();
  body.end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.i32Load), 1);
});

test("jit register exit stores use byte stores for isolated partial writes", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(ah, () => {
    body.i32Const(0x05);
  });
  regs.commitPending();
  regs.emitCommittedStore("eax");
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(countOpcode(opcodes, wasmOpcode.i32Load), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store8), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store16), 0);
});

test("jit register exit stores coalesce al and ah partial writes into a word store", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(al, () => {
    body.i32Const(0x05);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(ah, () => {
    body.i32Const(0x05);
  });
  regs.commitPending();
  regs.emitCommittedStore("eax");
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(countOpcode(opcodes, wasmOpcode.i32Load), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store8), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store16), 1);
});

test("jit register exit store planner keeps isolated byte writes narrow", () => {
  const state = emptyRegValueState();

  recordPartialValue(state, ah, 7);

  deepStrictEqual(planRegisterExitStore(state), {
    kind: "partial",
    stores: [
      {
        kind: "store8",
        byteIndex: 1,
        source: { local: 7, bitOffset: 0 }
      }
    ]
  });
});

test("jit register exit store planner coalesces adjacent byte writes into word stores", () => {
  const state = emptyRegValueState();

  recordPartialValue(state, al, 7);
  recordPartialValue(state, ah, 8);

  deepStrictEqual(planRegisterExitStore(state), {
    kind: "partial",
    stores: [
      {
        kind: "store16",
        byteIndex: 0,
        sources: [
          { local: 7, bitOffset: 0 },
          { local: 8, bitOffset: 0 }
        ]
      }
    ]
  });
});

test("jit register state keeps byte-only alu updates narrow", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(ah, () => {
    body.i32Const(0x05);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(ah, () => {
    regs.emitGetAlias(ah);
    regs.emitGetAlias(bl);
    body.i32Xor();
  });
  regs.commitPending();
  regs.emitCommittedStore("eax");
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(countOpcode(opcodes, wasmOpcode.i32Load), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store8), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store16), 0);
});

test("jit register state stores full registers after a partial write is materialized by a full read", () => {
  const body = new WasmFunctionBodyEncoder();
  const regs = createJitReg32State(body);

  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSetAlias(al, () => {
    body.i32Const(0x05);
  });
  regs.commitPending();
  regs.beginInstruction({ preserveCommittedRegs: false });
  regs.emitSet("ebx", () => {
    regs.emitGet("eax");
  });
  regs.commitPending();
  regs.emitCommittedStore("eax");
  regs.emitCommittedStore("ebx");
  body.end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(countOpcode(opcodes, wasmOpcode.i32Load), 1);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store), 2);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store8), 0);
  strictEqual(countOpcode(opcodes, wasmOpcode.i32Store16), 0);
});

test("jit register exit states store committed registers on a later memory fault", async () => {
  const result = await runJitIrBlock(
    [
      0xb8, 0x11, 0x11, 0x11, 0x11, // mov eax, 0x11111111
      0xbb, 0x22, 0x22, 0x22, 0x22, // mov ebx, 0x22222222
      0x89, 0x05, 0x00, 0x00, 0x01, 0x00, // mov [0x10000], eax
      0xb9, 0x33, 0x33, 0x33, 0x33 // mov ecx, 0x33333333
    ],
    createCpuState({
      eax: 0xaaaa_aaaa,
      ebx: 0xbbbb_bbbb,
      ecx: 0xcccc_cccc,
      eflags: 0xabcd_0000,
      eip: startAddress,
      instructionCount: 40
    })
  );

  deepStrictEqual(result.exit, { exitReason: ExitReason.MEMORY_WRITE_FAULT, payload: 0x10000, detail: 4 });
  strictEqual(result.state.eax, 0x1111_1111);
  strictEqual(result.state.ebx, 0x2222_2222);
  strictEqual(result.state.ecx, 0xcccc_cccc);
  strictEqual(result.state.eflags, 0xabcd_0000);
  strictEqual(result.state.eip, startAddress + 10);
  strictEqual(result.state.instructionCount, 42);
});

function countOpcode(opcodes: readonly number[], opcode: number): number {
  return opcodes.filter((entry) => entry === opcode).length;
}
