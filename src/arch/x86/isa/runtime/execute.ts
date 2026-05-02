import type { RunResult, RunResultDetails } from "../../../../core/execution/run-result.js";
import { runResultFromState, StopReason } from "../../../../core/execution/run-result.js";
import type { GuestMemory, MemoryFault } from "../../../../core/memory/guest-memory.js";
import {
  getFlag,
  getReg32,
  hasEvenParityLowByte,
  setFlag,
  setReg32,
  u32,
  type CpuState
} from "../../../../core/state/cpu-state.js";
import { buildSir } from "../../sir/builder.js";
import { CONDITIONS, type FlagBoolExpr } from "../../sir/conditions.js";
import { FLAG_PRODUCERS, type FlagDefs, type FlagExpr, type FlagName, type ValueExpr } from "../../sir/flags.js";
import type { MemRef, SirOp, StorageRef, ValueRef, VarRef } from "../../sir/types.js";
import type { IsaDecodedInstruction, IsaOperandBinding } from "../decoder/types.js";

export type IsaExecutionOptions = Readonly<{
  memory?: GuestMemory;
}>;

type ExecutionContext = Readonly<{
  state: CpuState;
  instruction: IsaDecodedInstruction;
  memory: GuestMemory | undefined;
  vars: Map<number, number>;
}>;

type ValueResult =
  | Readonly<{ kind: "value"; value: number }>
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "memoryFault"; fault: MemoryFault }>;

type WriteResult =
  | Readonly<{ kind: "ok" }>
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "memoryFault"; fault: MemoryFault }>;

export function executeIsaInstruction(
  state: CpuState,
  instruction: IsaDecodedInstruction,
  options: IsaExecutionOptions = {}
): RunResult {
  const context: ExecutionContext = { state, instruction, memory: options.memory, vars: new Map() };
  const program = buildSir(instruction.spec.semantics);

  for (const op of program) {
    const result = executeOp(context, op);

    if (result !== undefined) {
      return result;
    }
  }

  return stop(state, StopReason.UNSUPPORTED);
}

function executeOp(context: ExecutionContext, op: SirOp): RunResult | undefined {
  switch (op.op) {
    case "get32": {
      const read = readStorage(context, op.source);

      if (read.kind !== "value") {
        return stopFromAccess(context.state, read);
      }

      setVar(context, op.dst, read.value);
      return undefined;
    }
    case "set32": {
      const value = evalValueRef(context, op.value);
      const write = writeStorage(context, op.target, value);

      return write.kind === "ok" ? undefined : stopFromAccess(context.state, write);
    }
    case "address32": {
      const binding = context.instruction.operands[op.operand.index];

      if (binding?.kind !== "mem32") {
        return stop(context.state, StopReason.UNSUPPORTED);
      }

      setVar(context, op.dst, effectiveAddress(context.state, binding));
      return undefined;
    }
    case "const32":
      setVar(context, op.dst, op.value);
      return undefined;
    case "i32.add":
      setVar(context, op.dst, u32(evalValueRef(context, op.a) + evalValueRef(context, op.b)));
      return undefined;
    case "i32.sub":
      setVar(context, op.dst, u32(evalValueRef(context, op.a) - evalValueRef(context, op.b)));
      return undefined;
    case "i32.xor":
      setVar(context, op.dst, u32(evalValueRef(context, op.a) ^ evalValueRef(context, op.b)));
      return undefined;
    case "i32.and":
      setVar(context, op.dst, u32(evalValueRef(context, op.a) & evalValueRef(context, op.b)));
      return undefined;
    case "flags.set":
      setFlags(context, op.producer, op.inputs);
      return undefined;
    case "flags.materialize":
    case "flags.boundary":
      return undefined;
    case "condition":
      setVar(context, op.dst, evalCondition(context, op.cc) ? 1 : 0);
      return undefined;
    case "next":
      return completeInstruction(context, context.instruction.nextEip);
    case "jump":
      return completeInstruction(context, evalValueRef(context, op.target));
    case "conditionalJump":
      return completeInstruction(
        context,
        evalValueRef(context, op.condition) !== 0 ? evalValueRef(context, op.taken) : evalValueRef(context, op.notTaken)
      );
    case "hostTrap":
      return completeHostTrap(context, evalValueRef(context, op.vector));
  }
}

function readStorage(context: ExecutionContext, storage: StorageRef): ValueResult {
  switch (storage.kind) {
    case "operand": {
      const binding = context.instruction.operands[storage.index];

      return binding === undefined ? { kind: "unsupported" } : readOperandBinding(context, binding);
    }
    case "reg":
      return { kind: "value", value: getReg32(context.state, storage.reg) };
    case "mem":
      return readMemory(context, storage);
  }
}

function writeStorage(context: ExecutionContext, storage: StorageRef, value: number): WriteResult {
  switch (storage.kind) {
    case "operand": {
      const binding = context.instruction.operands[storage.index];

      return binding === undefined ? { kind: "unsupported" } : writeOperandBinding(context, binding, value);
    }
    case "reg":
      setReg32(context.state, storage.reg, value);
      return { kind: "ok" };
    case "mem":
      return writeMemory(context, storage, value);
  }
}

function readOperandBinding(context: ExecutionContext, binding: IsaOperandBinding): ValueResult {
  switch (binding.kind) {
    case "reg32":
      return { kind: "value", value: getReg32(context.state, binding.reg) };
    case "imm32":
      return { kind: "value", value: binding.value };
    case "relTarget":
      return { kind: "value", value: binding.target };
    case "mem32":
      return readGuestU32(context, effectiveAddress(context.state, binding));
  }
}

function writeOperandBinding(context: ExecutionContext, binding: IsaOperandBinding, value: number): WriteResult {
  switch (binding.kind) {
    case "reg32":
      setReg32(context.state, binding.reg, value);
      return { kind: "ok" };
    case "mem32":
      return writeGuestU32(context, effectiveAddress(context.state, binding), value);
    case "imm32":
    case "relTarget":
      return { kind: "unsupported" };
  }
}

function readMemory(context: ExecutionContext, storage: MemRef): ValueResult {
  return readGuestU32(context, evalValueRef(context, storage.address));
}

function writeMemory(context: ExecutionContext, storage: MemRef, value: number): WriteResult {
  return writeGuestU32(context, evalValueRef(context, storage.address), value);
}

function readGuestU32(context: ExecutionContext, address: number): ValueResult {
  const read = context.memory?.readU32(address);

  if (read === undefined) {
    return { kind: "unsupported" };
  }

  return read.ok ? { kind: "value", value: read.value } : { kind: "memoryFault", fault: read.fault };
}

function writeGuestU32(context: ExecutionContext, address: number, value: number): WriteResult {
  const write = context.memory?.writeU32(address, value);

  if (write === undefined) {
    return { kind: "unsupported" };
  }

  return write.ok ? { kind: "ok" } : { kind: "memoryFault", fault: write.fault };
}

function setFlags(
  context: ExecutionContext,
  producerName: keyof typeof FLAG_PRODUCERS,
  inputs: Readonly<Record<string, ValueRef>>
): void {
  const producer = FLAG_PRODUCERS[producerName] as Readonly<{
    inputs: readonly string[];
    define(inputs: Readonly<Record<string, ValueRef>>): FlagDefs;
  }>;

  for (const name of producer.inputs) {
    if (inputs[name] === undefined) {
      throw new Error(`missing ${producerName} flag input: ${name}`);
    }
  }

  for (const [flag, expr] of Object.entries(producer.define(inputs)) as [FlagName, FlagExpr][]) {
    setFlag(context.state, flag, evalFlagExpr(context, expr));
  }
}

function evalCondition(context: ExecutionContext, cc: keyof typeof CONDITIONS): boolean {
  return evalFlagBoolExpr(context, CONDITIONS[cc].expr);
}

function evalFlagBoolExpr(context: ExecutionContext, expr: FlagBoolExpr): boolean {
  switch (expr.kind) {
    case "flag":
      return getFlag(context.state, expr.flag);
    case "not":
      return !evalFlagBoolExpr(context, expr.value);
    case "and":
      return evalFlagBoolExpr(context, expr.a) && evalFlagBoolExpr(context, expr.b);
    case "or":
      return evalFlagBoolExpr(context, expr.a) || evalFlagBoolExpr(context, expr.b);
    case "xor":
      return evalFlagBoolExpr(context, expr.a) !== evalFlagBoolExpr(context, expr.b);
  }
}

function evalFlagExpr(context: ExecutionContext, expr: FlagExpr): boolean {
  switch (expr.kind) {
    case "constFlag":
      return expr.value !== 0;
    case "undefFlag":
      return false;
    case "eqz":
      return evalValueExpr(context, expr.value) === 0;
    case "ne0":
      return evalValueExpr(context, expr.value) !== 0;
    case "uLt":
      return evalValueExpr(context, expr.a) < evalValueExpr(context, expr.b);
    case "bit":
      return ((evalValueExpr(context, expr.value) >>> expr.bit) & 1) !== 0;
    case "parity8":
      return hasEvenParityLowByte(evalValueExpr(context, expr.value));
    case "signBit":
      return (evalValueExpr(context, expr.value) & signMask(expr.width)) !== 0;
  }
}

function evalValueExpr(context: ExecutionContext, expr: ValueExpr): number {
  switch (expr.kind) {
    case "and":
      return u32(evalValueExpr(context, expr.a) & evalValueExpr(context, expr.b));
    case "xor":
      return u32(evalValueExpr(context, expr.a) ^ evalValueExpr(context, expr.b));
    case "var":
    case "const32":
    case "nextEip":
      return evalValueRef(context, expr);
  }
}

function evalValueRef(context: ExecutionContext, value: ValueRef): number {
  switch (value.kind) {
    case "var": {
      const varValue = context.vars.get(value.id);

      if (varValue === undefined) {
        throw new Error(`SIR var ${value.id} read before definition`);
      }

      return varValue;
    }
    case "const32":
      return value.value;
    case "nextEip":
      return context.instruction.nextEip;
  }
}

function setVar(context: ExecutionContext, ref: VarRef, value: number): void {
  context.vars.set(ref.id, u32(value));
}

function effectiveAddress(state: CpuState, binding: Extract<IsaOperandBinding, { kind: "mem32" }>): number {
  const base = binding.base === undefined ? 0 : getReg32(state, binding.base);
  const index = binding.index === undefined ? 0 : u32(getReg32(state, binding.index) * binding.scale);

  return u32(base + index + binding.disp);
}

function signMask(width: 8 | 16 | 32): number {
  return width === 32 ? 0x8000_0000 : width === 16 ? 0x8000 : 0x80;
}

function completeInstruction(context: ExecutionContext, target: number): RunResult {
  context.state.eip = u32(target);
  context.state.instructionCount = u32(context.state.instructionCount + 1);

  return runResultFromState(context.state, StopReason.NONE);
}

function completeHostTrap(context: ExecutionContext, vector: number): RunResult {
  context.state.eip = context.instruction.nextEip;
  context.state.instructionCount = u32(context.state.instructionCount + 1);
  context.state.stopReason = StopReason.HOST_TRAP;

  return runResultFromState(context.state, StopReason.HOST_TRAP, { trapVector: vector & 0xff });
}

function stopFromAccess(state: CpuState, access: ValueResult | WriteResult): RunResult {
  switch (access.kind) {
    case "unsupported":
      return stop(state, StopReason.UNSUPPORTED);
    case "memoryFault":
      return stop(state, StopReason.MEMORY_FAULT, access.fault);
    case "value":
    case "ok":
      throw new Error(`cannot stop from successful ${access.kind} access`);
  }
}

function stop(state: CpuState, reason: StopReason, details: RunResultDetails = {}): RunResult {
  state.stopReason = reason;
  return runResultFromState(state, reason, details);
}
