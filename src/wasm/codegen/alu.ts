import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { eflagsMask, i32, supportedEflagsMask } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import type { WasmLocalScratchAllocator } from "./local-scratch.js";
import { emitReadOperandU32, emitWriteOperandU32 } from "./operands.js";
import { emitCompleteInstruction, emitLoadStateU32, emitStoreStateStackU32 } from "./state.js";

type AluMnemonic = Extract<DecodedInstruction["mnemonic"], "add" | "sub" | "xor" | "cmp" | "test">;
type FlagOperation = "add" | "sub" | "logical";

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

export function emitAlu(
  body: WasmFunctionBodyEncoder,
  scratch: WasmLocalScratchAllocator,
  instruction: DecodedInstruction
): void {
  const mnemonic = instruction.mnemonic;

  if (!isAluMnemonic(mnemonic)) {
    throw new Error(`unsupported ALU instruction for Wasm codegen: ${mnemonic}`);
  }

  const destination = instruction.operands[0];

  const locals = addAluLocals(
    scratch,
    emitReadOperandU32(body, scratch, destination),
    emitReadOperandU32(body, scratch, instruction.operands[1], { signExtendImm8: signExtendImm8Source(mnemonic) })
  );
  emitAluResult(body, mnemonic, locals);
  body.localSet(locals.result);

  if (writesDestination(mnemonic)) {
    emitWriteOperandU32(body, scratch, destination, locals.result);
  }

  emitAluFlags(body, flagOperation(mnemonic), locals);
  emitCompleteInstruction(body, instruction);
  freeAluLocals(scratch, locals);
}

function addAluLocals(scratch: WasmLocalScratchAllocator, left: number, right: number): AluLocals {
  return {
    left,
    right,
    result: scratch.allocLocal(wasmValueType.i32),
    flags: scratch.allocLocal(wasmValueType.i32)
  };
}

function freeAluLocals(scratch: WasmLocalScratchAllocator, locals: AluLocals): void {
  scratch.freeLocal(locals.flags);
  scratch.freeLocal(locals.result);
  scratch.freeLocal(locals.right);
  scratch.freeLocal(locals.left);
}

function emitAluResult(body: WasmFunctionBodyEncoder, mnemonic: AluMnemonic, locals: AluLocals): void {
  body.localGet(locals.left).localGet(locals.right);

  switch (mnemonic) {
    case "add":
      body.i32Add();
      return;
    case "sub":
    case "cmp":
      body.i32Sub();
      return;
    case "xor":
      body.i32Xor();
      return;
    case "test":
      body.i32And();
      return;
  }
}

function emitAluFlags(body: WasmFunctionBodyEncoder, operation: FlagOperation, locals: AluLocals): void {
  body.i32Const(0).localSet(locals.flags);

  emitResultFlags(body, locals);

  switch (operation) {
    case "add":
      emitAddFlags(body, locals);
      break;
    case "sub":
      emitSubFlags(body, locals);
      break;
    case "logical":
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

function isAluMnemonic(mnemonic: DecodedInstruction["mnemonic"]): mnemonic is AluMnemonic {
  return mnemonic === "add" || mnemonic === "sub" || mnemonic === "xor" || mnemonic === "cmp" || mnemonic === "test";
}

function writesDestination(mnemonic: AluMnemonic): boolean {
  return mnemonic === "add" || mnemonic === "sub" || mnemonic === "xor";
}

function signExtendImm8Source(mnemonic: AluMnemonic): boolean {
  return mnemonic === "add" || mnemonic === "sub" || mnemonic === "cmp";
}

function flagOperation(mnemonic: AluMnemonic): FlagOperation {
  switch (mnemonic) {
    case "add":
      return "add";
    case "sub":
    case "cmp":
      return "sub";
    case "xor":
    case "test":
      return "logical";
  }
}
