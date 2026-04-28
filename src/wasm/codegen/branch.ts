import { instructionEnd } from "../../arch/x86/instruction/address.js";
import type { JccCondition } from "../../arch/x86/instruction/condition.js";
import { relativeTarget } from "../../arch/x86/instruction/operands.js";
import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { eflagsMask } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitExitResult } from "./exit.js";
import { emitLoadStateU32, emitCompleteAtEip } from "./state.js";

type FlagName = keyof typeof eflagsMask;

export function emitJmp(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const target = relativeTarget(instruction);

  emitCompleteAtEip(body, target);
  emitExitResult(body, ExitReason.JUMP, target).returnFromFunction();
}

export function emitJcc(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  if (instruction.condition === undefined) {
    throw new Error("jcc instruction is missing a condition");
  }

  const target = relativeTarget(instruction);
  const fallthrough = instructionEnd(instruction);

  emitJccCondition(body, instruction.condition);
  body.ifBlock();
  emitCompleteAtEip(body, target);
  emitExitResult(body, ExitReason.BRANCH_TAKEN, target).returnFromFunction();
  body.endBlock();

  emitCompleteAtEip(body, fallthrough);
  emitExitResult(body, ExitReason.BRANCH_NOT_TAKEN, fallthrough).returnFromFunction();
}

function emitJccCondition(body: WasmFunctionBodyEncoder, condition: JccCondition): void {
  const flags = body.addLocal(wasmValueType.i32);

  emitLoadStateU32(body, stateOffset.eflags);
  body.localSet(flags);

  switch (condition) {
    case "jo":
      emitFlag(body, flags, "OF");
      return;
    case "jno":
      emitFlag(body, flags, "OF", false);
      return;
    case "jb":
      emitFlag(body, flags, "CF");
      return;
    case "jae":
      emitFlag(body, flags, "CF", false);
      return;
    case "jz":
      emitFlag(body, flags, "ZF");
      return;
    case "jnz":
      emitFlag(body, flags, "ZF", false);
      return;
    case "jbe":
      emitFlag(body, flags, "CF");
      emitFlag(body, flags, "ZF");
      body.i32Or();
      return;
    case "ja":
      emitFlag(body, flags, "CF", false);
      emitFlag(body, flags, "ZF", false);
      body.i32And();
      return;
    case "js":
      emitFlag(body, flags, "SF");
      return;
    case "jns":
      emitFlag(body, flags, "SF", false);
      return;
    case "jp":
      emitFlag(body, flags, "PF");
      return;
    case "jnp":
      emitFlag(body, flags, "PF", false);
      return;
    case "jl":
      emitSignOverflowMismatch(body, flags);
      return;
    case "jge":
      emitSignOverflowMismatch(body, flags);
      body.i32Eqz();
      return;
    case "jle":
      emitFlag(body, flags, "ZF");
      emitSignOverflowMismatch(body, flags);
      body.i32Or();
      return;
    case "jg":
      emitFlag(body, flags, "ZF", false);
      emitSignOverflowMismatch(body, flags);
      body.i32Eqz();
      body.i32And();
      return;
  }
}

function emitSignOverflowMismatch(body: WasmFunctionBodyEncoder, flags: number): void {
  emitFlag(body, flags, "SF");
  emitFlag(body, flags, "OF");
  body.i32Xor();
}

function emitFlag(
  body: WasmFunctionBodyEncoder,
  flags: number,
  flag: FlagName,
  expected = true
): void {
  body.localGet(flags).i32Const(eflagsMask[flag]).i32And().i32Eqz();

  if (expected) {
    body.i32Eqz();
  }
}
