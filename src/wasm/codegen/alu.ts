import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { eflagsMask, i32, supportedEflagsMask } from "../../core/state/cpu-state.js";
import { reg32StateOffset, stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { emitCompleteInstruction, emitLoadStateU32, emitStoreStateStackU32 } from "./state.js";

type AluMnemonic = Extract<DecodedInstruction["mnemonic"], "add" | "sub" | "xor">;

type AluLocals = Readonly<{
  left: number;
  right: number;
  result: number;
  flags: number;
}>;

const lowByteMask = 0xff;
const signMask = 0x8000_0000;
const cfBit = 0;
const pfBit = 2;
const sfBit = 7;
const zfBit = 6;
const ofBit = 11;

export function emitRegisterAlu(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const mnemonic = instruction.mnemonic;

  if (mnemonic !== "add" && mnemonic !== "sub" && mnemonic !== "xor") {
    throw new Error(`unsupported ALU instruction for Wasm codegen: ${mnemonic}`);
  }

  const destination = instruction.operands[0];
  const source = instruction.operands[1];

  if (destination?.kind !== "reg32" || source?.kind !== "reg32") {
    throw new Error("unsupported ALU form for Wasm codegen");
  }

  const locals = addAluLocals(body);

  emitLoadStateU32(body, reg32StateOffset(destination.reg));
  body.localSet(locals.left);
  emitLoadStateU32(body, reg32StateOffset(source.reg));
  body.localSet(locals.right);

  body.localGet(0);
  emitAluResult(body, mnemonic, locals);
  body.localTee(locals.result);
  emitStoreStateStackU32(body, reg32StateOffset(destination.reg));

  emitAluFlags(body, mnemonic, locals);
  emitCompleteInstruction(body, instruction);
}

function addAluLocals(body: WasmFunctionBodyEncoder): AluLocals {
  return {
    left: body.addLocal(wasmValueType.i32),
    right: body.addLocal(wasmValueType.i32),
    result: body.addLocal(wasmValueType.i32),
    flags: body.addLocal(wasmValueType.i32)
  };
}

function emitAluResult(body: WasmFunctionBodyEncoder, mnemonic: AluMnemonic, locals: AluLocals): void {
  body.localGet(locals.left).localGet(locals.right);

  switch (mnemonic) {
    case "add":
      body.i32Add();
      return;
    case "sub":
      body.i32Sub();
      return;
    case "xor":
      body.i32Xor();
      return;
  }
}

function emitAluFlags(body: WasmFunctionBodyEncoder, mnemonic: AluMnemonic, locals: AluLocals): void {
  body.i32Const(0).localSet(locals.flags);

  emitResultFlags(body, locals);

  switch (mnemonic) {
    case "add":
      emitAddFlags(body, locals);
      break;
    case "sub":
      emitSubFlags(body, locals);
      break;
    case "xor":
      break;
  }

  emitWriteFlags(body, locals.flags);
}

function emitResultFlags(body: WasmFunctionBodyEncoder, locals: AluLocals): void {
  emitBooleanFlag(body, locals.flags, sfBit, () => {
    body
      .localGet(locals.result)
      .i32Const(i32(signMask))
      .i32And()
      .i32Eqz()
      .i32Eqz();
  });

  emitBooleanFlag(body, locals.flags, zfBit, () => {
    body.localGet(locals.result).i32Eqz();
  });

  emitBooleanFlag(body, locals.flags, pfBit, () => {
    body
      .localGet(locals.result)
      .i32Const(lowByteMask)
      .i32And()
      .i32Popcnt()
      .i32Const(1)
      .i32And()
      .i32Eqz();
  });
}

function emitAddFlags(body: WasmFunctionBodyEncoder, locals: AluLocals): void {
  emitBooleanFlag(body, locals.flags, cfBit, () => {
    body.localGet(locals.result).localGet(locals.left).i32LtU();
  });

  emitAuxCarryFlag(body, locals);

  emitBooleanFlag(body, locals.flags, ofBit, () => {
    body
      .localGet(locals.left)
      .localGet(locals.result)
      .i32Xor()
      .localGet(locals.right)
      .localGet(locals.result)
      .i32Xor()
      .i32And()
      .i32Const(i32(signMask))
      .i32And()
      .i32Eqz()
      .i32Eqz();
  });
}

function emitSubFlags(body: WasmFunctionBodyEncoder, locals: AluLocals): void {
  emitBooleanFlag(body, locals.flags, cfBit, () => {
    body.localGet(locals.left).localGet(locals.right).i32LtU();
  });

  emitAuxCarryFlag(body, locals);

  emitBooleanFlag(body, locals.flags, ofBit, () => {
    body
      .localGet(locals.left)
      .localGet(locals.right)
      .i32Xor()
      .localGet(locals.left)
      .localGet(locals.result)
      .i32Xor()
      .i32And()
      .i32Const(i32(signMask))
      .i32And()
      .i32Eqz()
      .i32Eqz();
  });
}

function emitAuxCarryFlag(body: WasmFunctionBodyEncoder, locals: AluLocals): void {
  emitOrFlagBits(body, locals.flags, () => {
    body
      .localGet(locals.left)
      .localGet(locals.right)
      .i32Xor()
      .localGet(locals.result)
      .i32Xor()
      .i32Const(eflagsMask.AF)
      .i32And();
  });
}

function emitBooleanFlag(
  body: WasmFunctionBodyEncoder,
  flags: number,
  bit: number,
  emitCondition: () => void
): void {
  emitOrFlagBits(body, flags, () => {
    emitCondition();
    body.i32Const(bit).i32Shl();
  });
}

function emitOrFlagBits(body: WasmFunctionBodyEncoder, flags: number, emitBits: () => void): void {
  body.localGet(flags);
  emitBits();
  body.i32Or().localSet(flags);
}

function emitWriteFlags(body: WasmFunctionBodyEncoder, flags: number): void {
  body.localGet(0);
  emitLoadStateU32(body, stateOffset.eflags);
  body.i32Const(i32(~supportedEflagsMask)).i32And().localGet(flags).i32Or();
  emitStoreStateStackU32(body, stateOffset.eflags);
}
