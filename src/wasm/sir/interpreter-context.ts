import type { Reg32 } from "../../arch/x86/instruction/types.js";
import type {
  SirProgram,
  StorageRef,
  ValueRef
} from "../../arch/x86/sir/types.js";
import { wasmMemoryIndex } from "../abi.js";
import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import { emitLoadGuestU32, emitStoreGuestU32 } from "../codegen/guest-memory.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import {
  emitCompleteInstruction,
  emitCompleteInstructionWithTarget,
  emitLoadReg32,
  emitModRmRegAddress,
  emitModRmRmAddress,
  emitOpcodeRegAddress,
  emitStoreReg32
} from "../interpreter/state.js";
import { emitIfModRmMemory, emitIfModRmRegister } from "../interpreter/modrm-bits.js";
import { lowerSirToWasm, type WasmSirEmitHelpers } from "./lower.js";
import { emitSetFlags } from "./flags.js";
import { emitCondition } from "./conditions.js";
import { ExitReason } from "../exit.js";

export type InterpreterOperandBinding =
  | Readonly<{ kind: "opcode.reg32"; opcodeLocal: number }>
  | Readonly<{ kind: "modrm.reg32"; modRmLocal: number }>
  | Readonly<{ kind: "rm32"; modRmLocal: number; addressLocal: number }>
  | Readonly<{ kind: "mem32"; addressLocal: number }>
  | Readonly<{ kind: "implicit.reg32"; reg: Reg32 }>
  | Readonly<{ kind: "imm32"; local: number }>
  | Readonly<{ kind: "relTarget32"; local: number }>;

export type InterpreterInstructionLength =
  | number
  | Readonly<{ kind: "local"; local: number }>;

export type InterpreterSirContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  eipLocal: number;
  instructionLength: InterpreterInstructionLength;
  operands: readonly InterpreterOperandBinding[];
  instructionDoneLabelDepth: number;
}>;

export function lowerSirWithInterpreterContext(program: SirProgram, context: InterpreterSirContext): void {
  lowerSirToWasm(program, {
    body: context.body,
    scratch: context.scratch,
    emitGet32: (source, helpers) => emitGet32(context, source, helpers),
    emitSet32: (target, value, helpers) => emitSet32(context, target, value, helpers),
    emitAddress32: (source) => emitAddress32(context, source),
    emitSetFlags: (producer, inputs, helpers) =>
      emitSetFlags(context.body, context.scratch, producer, inputs, helpers),
    emitCondition: (cc) => emitCondition(context.body, cc),
    emitNext: () => emitNext(context),
    emitNextEip: () => emitNextEip(context),
    emitJump: (target, helpers) => emitJump(context, target, helpers),
    emitConditionalJump: (condition, taken, notTaken, helpers) =>
      emitConditionalJump(context, condition, taken, notTaken, helpers),
    emitHostTrap: (vector, helpers) => emitHostTrap(context, vector, helpers)
  });
}

function emitGet32(context: InterpreterSirContext, source: StorageRef, helpers: WasmSirEmitHelpers): void {
  switch (source.kind) {
    case "operand":
      emitGetOperand32(context, source.index);
      return;
    case "reg":
      emitLoadReg32(context.body, source.reg);
      return;
    case "mem":
      helpers.emitValue(source.address);
      emitLoadGuestU32FromStack(context);
      return;
  }
}

function emitSet32(
  context: InterpreterSirContext,
  target: StorageRef,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  switch (target.kind) {
    case "operand":
      emitSetOperand32(context, target.index, value, helpers);
      return;
    case "reg":
      emitStoreReg32(context.body, target.reg, () => helpers.emitValue(value));
      return;
    case "mem":
      emitStoreMem32(context, () => helpers.emitValue(target.address), () => helpers.emitValue(value));
      return;
  }
}

function emitAddress32(context: InterpreterSirContext, source: StorageRef): void {
  if (source.kind !== "operand") {
    throw new Error(`unsupported address32 source for Wasm interpreter: ${source.kind}`);
  }

  const binding = operandBinding(context, source.index);

  if (binding.kind !== "mem32") {
    throw new Error(`address32 operand is not memory: ${binding.kind}`);
  }

  context.body.localGet(binding.addressLocal);
}

function emitGetOperand32(context: InterpreterSirContext, index: number): void {
  const binding = operandBinding(context, index);

  switch (binding.kind) {
    case "opcode.reg32":
      emitOpcodeRegAddress(context.body, binding.opcodeLocal);
      context.body.i32Load({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "modrm.reg32":
      emitModRmRegAddress(context.body, binding.modRmLocal);
      context.body.i32Load({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "rm32":
      emitGetRm32(context, binding);
      return;
    case "mem32":
      emitLoadGuestU32(context.body, binding.addressLocal);
      return;
    case "implicit.reg32":
      emitLoadReg32(context.body, binding.reg);
      return;
    case "imm32":
    case "relTarget32":
      context.body.localGet(binding.local);
      return;
  }
}

function emitSetOperand32(
  context: InterpreterSirContext,
  index: number,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  const binding = operandBinding(context, index);

  switch (binding.kind) {
    case "opcode.reg32":
      emitOpcodeRegAddress(context.body, binding.opcodeLocal);
      helpers.emitValue(value);
      context.body.i32Store({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "modrm.reg32":
      emitModRmRegAddress(context.body, binding.modRmLocal);
      helpers.emitValue(value);
      context.body.i32Store({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
      return;
    case "rm32":
      emitSetRm32(context, binding, value, helpers);
      return;
    case "mem32":
      emitStoreMem32(context, () => context.body.localGet(binding.addressLocal), () => helpers.emitValue(value));
      return;
    case "implicit.reg32":
      emitStoreReg32(context.body, binding.reg, () => helpers.emitValue(value));
      return;
    case "imm32":
    case "relTarget32":
      throw new Error(`cannot set ${binding.kind} operand`);
  }
}

function emitNext(context: InterpreterSirContext): void {
  if (typeof context.instructionLength === "number") {
    emitCompleteInstruction(context.body, context.eipLocal, context.instructionLength);
  } else {
    emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => emitNextEip(context));
  }
  emitContinue(context);
}

function emitNextEip(context: InterpreterSirContext): void {
  context.body.localGet(context.eipLocal);

  if (typeof context.instructionLength === "number") {
    context.body.i32Const(context.instructionLength);
  } else {
    context.body.localGet(context.instructionLength.local);
  }

  context.body.i32Add();
}

function emitJump(context: InterpreterSirContext, target: ValueRef, helpers: WasmSirEmitHelpers): void {
  emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => helpers.emitValue(target));
  emitContinue(context);
}

function emitConditionalJump(
  context: InterpreterSirContext,
  condition: ValueRef,
  taken: ValueRef,
  notTaken: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  helpers.emitValue(condition);
  context.body.ifBlock();
  emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => helpers.emitValue(taken));
  emitContinue(context, 1);
  context.body.endBlock();
  emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => helpers.emitValue(notTaken));
  emitContinue(context);
}

function emitHostTrap(context: InterpreterSirContext, vector: ValueRef, helpers: WasmSirEmitHelpers): void {
  if (typeof context.instructionLength === "number") {
    emitCompleteInstruction(context.body, context.eipLocal, context.instructionLength);
  } else {
    emitCompleteInstructionWithTarget(context.body, context.eipLocal, () => emitNextEip(context));
  }

  helpers.emitValue(vector);
  emitExitResultFromStackPayload(context.body, ExitReason.HOST_TRAP).returnFromFunction();
}

function emitContinue(context: InterpreterSirContext, extraDepth = 0): void {
  context.body.br(context.instructionDoneLabelDepth + extraDepth);
}

function emitGetRm32(
  context: InterpreterSirContext,
  binding: Extract<InterpreterOperandBinding, { kind: "rm32" }>
): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitIfModRmRegister(context.body, binding.modRmLocal, () => {
      emitModRmRmAddress(context.body, binding.modRmLocal);
      context.body.i32Load({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state }).localSet(valueLocal);
    });
    emitIfModRmMemory(context.body, binding.modRmLocal, () => {
      emitLoadGuestU32(context.body, binding.addressLocal);
      context.body.localSet(valueLocal);
    });
    context.body.localGet(valueLocal);
  } finally {
    context.scratch.freeLocal(valueLocal);
  }
}

function emitSetRm32(
  context: InterpreterSirContext,
  binding: Extract<InterpreterOperandBinding, { kind: "rm32" }>,
  value: ValueRef,
  helpers: WasmSirEmitHelpers
): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    helpers.emitValue(value);
    context.body.localSet(valueLocal);
    emitIfModRmRegister(context.body, binding.modRmLocal, () => {
      emitModRmRmAddress(context.body, binding.modRmLocal);
      context.body.localGet(valueLocal);
      context.body.i32Store({ align: 2, offset: 0, memoryIndex: wasmMemoryIndex.state });
    });
    emitIfModRmMemory(context.body, binding.modRmLocal, () => {
      emitStoreMem32(context, () => context.body.localGet(binding.addressLocal), () => context.body.localGet(valueLocal));
    });
  } finally {
    context.scratch.freeLocal(valueLocal);
  }
}

function emitLoadGuestU32FromStack(context: InterpreterSirContext): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    context.body.localSet(addressLocal);
    emitLoadGuestU32(context.body, addressLocal);
  } finally {
    context.scratch.freeLocal(addressLocal);
  }
}

function emitStoreMem32(context: InterpreterSirContext, emitAddress: () => void, emitValue: () => void): void {
  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitAddress();
    context.body.localSet(addressLocal);
    emitValue();
    context.body.localSet(valueLocal);
    emitStoreGuestU32(context.body, addressLocal, valueLocal);
  } finally {
    context.scratch.freeLocal(valueLocal);
    context.scratch.freeLocal(addressLocal);
  }
}

function operandBinding(context: InterpreterSirContext, index: number): InterpreterOperandBinding {
  const binding = context.operands[index];

  if (binding === undefined) {
    throw new Error(`missing interpreter operand binding: ${index}`);
  }

  return binding;
}
