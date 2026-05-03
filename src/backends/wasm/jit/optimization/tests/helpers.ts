import { strictEqual } from "node:assert";

import type { Reg32 } from "#x86/isa/types.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import type { ConditionCode, IrBlock, ValueRef, VarRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitExitPoint } from "#backends/wasm/jit/optimization/tracked/types.js";
import type { JitFlagOwnerMask } from "#backends/wasm/jit/optimization/flags/owners.js";
import type {
  JitIrBlock,
  JitIrBody,
  JitIrBlockInstruction,
  JitOptimizedIrBlockInstruction
} from "#backends/wasm/jit/types.js";

export const startAddress = 0x1000;

export function onlyExit(exits: readonly JitExitPoint[], reason: ExitReasonValue): JitExitPoint {
  const matches = exits.filter((entry) => entry.exitReason === reason);

  strictEqual(matches.length, 1);
  return matches[0]!;
}

export function logic32LocalConditionBlock(cc: ConditionCode): JitIrBlock {
  return {
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.and", dst: v(1), a: v(0), b: c32(0xff) },
        createIrFlagSetOp("logic32", { result: v(1) }),
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ], 0),
      syntheticInstruction([
        { op: "aluFlags.condition", dst: v(0), cc },
        { op: "set32.if", condition: v(0), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ], 1)
    ]
  };
}

export function syntheticInstruction(
  ir: IrBlock,
  index = 0,
  nextMode: JitIrBlock["instructions"][number]["nextMode"] = "continue"
): JitIrBlock["instructions"][number] {
  return {
    instructionId: `synthetic.${index}`,
    eip: startAddress + index,
    nextEip: startAddress + index + 1,
    nextMode,
    operands: [],
    ir
  };
}

export function set32TargetRegs(
  instructions: readonly (JitIrBlockInstruction | JitOptimizedIrBlockInstruction)[]
): readonly Reg32[] {
  return instructions.flatMap((instruction) =>
    instructionOps(instruction).flatMap((op) => {
      if (op.op !== "set32") {
        return [];
      }

      switch (op.target.kind) {
        case "reg":
          return [op.target.reg];
        case "operand": {
          const binding = instruction.operands[op.target.index];

          return binding?.kind === "static.reg32" ? [binding.reg] : [];
        }
        case "mem":
          return [];
      }
    })
  );
}

function instructionOps(instruction: JitIrBlockInstruction | JitOptimizedIrBlockInstruction): JitIrBody {
  return "prelude" in instruction
    ? [...instruction.prelude, ...instruction.ir]
    : instruction.ir;
}

export function flagOwnerSummary(owners: readonly JitFlagOwnerMask[]): readonly object[] {
  return owners.map(({ mask, owner }) => {
    switch (owner.kind) {
      case "producer":
        return { mask, kind: owner.kind, sourceId: owner.source.id, producer: owner.source.producer };
      case "incoming":
      case "materialized":
        return { mask, kind: owner.kind };
    }
  });
}

export function v(id: number): VarRef {
  return { kind: "var", id };
}

export function c32(value: number): ValueRef {
  return { kind: "const32", value };
}
