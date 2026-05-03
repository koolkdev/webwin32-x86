import { toJitOptimizedIrPreludeOp } from "#backends/wasm/jit/prelude.js";
import type {
  JitIrBlock,
  JitIrBlockInstruction,
  JitIrOp,
  JitOptimizedIrBlock,
  JitOptimizedIrBlockInstruction
} from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import { analyzeJitFlags } from "#backends/wasm/jit/optimization/flags/analysis.js";
import {
  emitDirectFlagCondition,
  indexDirectFlagConditions
} from "#backends/wasm/jit/optimization/flags/conditions.js";
import type { JitFlagMaterialization } from "#backends/wasm/jit/optimization/flags/materialization.js";
import type {
  JitOptimizationPlan,
  JitOptimizationPlanRecord
} from "#backends/wasm/jit/optimization/planner/plan.js";
import {
  firstRegisterFoldableOpIndex,
  recordCopiedRegisterOp
} from "#backends/wasm/jit/optimization/registers/folding-prefix.js";
import {
  assignJitValue,
  createJitPreludeRewrite,
  rewriteJitIrInstruction,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "#backends/wasm/jit/optimization/ir/rewrite.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";
import { jitTrackedRegisterLocation } from "#backends/wasm/jit/optimization/tracked/state.js";
import type { JitRegisterFolding } from "#backends/wasm/jit/optimization/passes/register-folding.js";
import { syncRegisterReadCounts } from "#backends/wasm/jit/optimization/registers/policy.js";

export function emitJitFlagMaterializationFromPlan(
  plan: JitOptimizationPlan,
  optimizationAnalysis: JitOptimizationAnalysis
): Readonly<{ block: JitIrBlock; flags: JitFlagMaterialization }> {
  const flagAnalysis = analyzeJitFlags(plan.block, optimizationAnalysis);
  const directConditionsByLocation = indexDirectFlagConditions(plan.block, flagAnalysis);
  const recordIndex = indexPlanRecords(plan.records);
  const instructions = new Array<JitIrBlockInstruction>(plan.block.instructions.length);
  let removedSetCount = 0;
  let retainedSetCount = 0;
  let directConditionCount = 0;

  for (let instructionIndex = 0; instructionIndex < plan.block.instructions.length; instructionIndex += 1) {
    const instruction = plan.block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while emitting planned flag materialization: ${instructionIndex}`);
    }

    instructions[instructionIndex] = rewriteJitIrInstruction(
      instruction,
      instructionIndex,
      "emitting planned flag materialization",
      ({ op, opIndex, rewrite }) => {
        const pointRecords = planRecordsAt(recordIndex, instructionIndex, opIndex);

        if (op.op === "flags.set" && hasPlannedDrop(pointRecords, "flags", "flags.set")) {
          removedSetCount += 1;
          return;
        }

        if (op.op === "aluFlags.condition" && hasPlannedFold(pointRecords, "flags", "flagCondition")) {
          const directCondition = directConditionsByLocation.get(instructionIndex)?.get(opIndex);

          if (directCondition === undefined) {
            throw new Error(`missing planned direct flag condition: ${instructionIndex}:${opIndex}`);
          }

          emitDirectFlagCondition(rewrite, op, directCondition);
          directConditionCount += 1;
          return;
        }

        if (op.op === "flags.set") {
          retainedSetCount += 1;
        }

        rewrite.ops.push(op);
      }
    );
  }

  return {
    block: { instructions },
    flags: {
      removedSetCount,
      retainedSetCount,
      directConditionCount,
      sourceClobberCount: plan.stats.sourceClobberCount
    }
  };
}

export function emitJitRegisterFoldingFromPlan(
  plan: JitOptimizationPlan,
  analysis: JitOptimizationAnalysis
): Readonly<{ block: JitOptimizedIrBlock; folding: JitRegisterFolding }> {
  const state = new JitOptimizationState(analysis.context);
  const recordIndex = indexPlanRecords(plan.records);
  const instructions: JitOptimizedIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let materializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < plan.block.instructions.length; instructionIndex += 1) {
    const instruction = plan.block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while emitting planned register folding: ${instructionIndex}`);
    }

    const prelude = createJitPreludeRewrite();
    materializedSetCount += materializePlannedRegisterValues(
      prelude,
      state,
      planRecordsAt(recordIndex, instructionIndex, undefined),
      "prelude"
    );

    const rewrite = state.beginInstructionRewrite(instruction);
    const firstFoldableOpIndex = firstRegisterFoldableOpIndex(instructionIndex, state);

    rewriteJitIrInstructionInto(
      instruction,
      instructionIndex,
      "emitting planned register folding",
      rewrite,
      ({ op, opIndex }) => {
        if (opIndex < firstFoldableOpIndex) {
          recordCopiedRegisterOp(op, instruction, rewrite);
          rewrite.ops.push(op);
          return;
        }

        const result = emitPlannedRegisterOp(
          op,
          instruction,
          rewrite,
          state,
          planRecordsAt(recordIndex, instructionIndex, opIndex)
        );

        removedSetCount += result.removedSetCount;
        materializedSetCount += result.materializedSetCount;
      }
    );

    instructions.push({
      ...instruction,
      prelude: prelude.ops.map(toJitOptimizedIrPreludeOp),
      ir: rewrite.ops
    });
  }

  if (state.tracked.registers.size !== 0) {
    throw new Error("planned JIT register values were not materialized before block end");
  }

  return {
    block: { instructions },
    folding: { removedSetCount, materializedSetCount }
  };
}

type JitPlanRecordIndex = Readonly<{
  byPoint: ReadonlyMap<string, readonly JitOptimizationPlanRecord[]>;
}>;

type JitPlannedRegisterEmitResult = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

function indexPlanRecords(records: readonly JitOptimizationPlanRecord[]): JitPlanRecordIndex {
  const byPoint = new Map<string, JitOptimizationPlanRecord[]>();

  for (const record of records) {
    const key = planPointKey(record.instructionIndex, record.opIndex);
    const pointRecords = byPoint.get(key);

    if (pointRecords === undefined) {
      byPoint.set(key, [record]);
    } else {
      pointRecords.push(record);
    }
  }

  return { byPoint };
}

function planRecordsAt(
  index: JitPlanRecordIndex,
  instructionIndex: number,
  opIndex: number | undefined
): readonly JitOptimizationPlanRecord[] {
  return index.byPoint.get(planPointKey(instructionIndex, opIndex)) ?? [];
}

function planPointKey(instructionIndex: number, opIndex: number | undefined): string {
  return opIndex === undefined
    ? `${instructionIndex}:prelude`
    : `${instructionIndex}:${opIndex}`;
}

function hasPlannedDrop(
  records: readonly JitOptimizationPlanRecord[],
  domain: "flags" | "registers",
  op: "flags.set" | "set32"
): boolean {
  return records.some((record) =>
    record.kind === "drop" &&
    record.domain === domain &&
    record.op === op
  );
}

function hasPlannedFold(
  records: readonly JitOptimizationPlanRecord[],
  domain: "flags" | "registers",
  foldKind: "registerValue" | "flagCondition"
): boolean {
  return records.some((record) =>
    record.kind === "fold" &&
    record.domain === domain &&
    record.foldKind === foldKind
  );
}

function emitPlannedRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState,
  records: readonly JitOptimizationPlanRecord[]
): JitPlannedRegisterEmitResult {
  let materializedSetCount = materializePlannedRegisterValues(
    rewrite,
    state,
    records,
    "beforeOp"
  );

  switch (op.op) {
    case "get32":
      emitPlannedRegisterGet32(op, instruction, rewrite, state);
      return { removedSetCount: 0, materializedSetCount };
    case "const32":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return { removedSetCount: 0, materializedSetCount };
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return { removedSetCount: 0, materializedSetCount };
    case "address32":
      emitPlannedRegisterAddress32(op, instruction, rewrite, state);
      return { removedSetCount: 0, materializedSetCount };
    case "set32":
      return {
        removedSetCount: emitPlannedRegisterSet32(op, instruction, rewrite, state, records),
        materializedSetCount
      };
    case "set32.if":
      emitPlannedRegisterSet32If(op, instruction, rewrite, state);
      return { removedSetCount: 0, materializedSetCount };
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap":
      materializedSetCount += materializePlannedRegisterValues(
        rewrite,
        state,
        records,
        "beforeExit"
      );
      rewrite.ops.push(op);
      return { removedSetCount: 0, materializedSetCount };
    default:
      rewrite.ops.push(op);
      return { removedSetCount: 0, materializedSetCount };
  }
}

function emitPlannedRegisterGet32(
  op: Extract<JitIrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): void {
  const { registers } = state.tracked;
  const sourceReg = jitStorageReg(op.source, instruction.operands);
  const value = registers.valueForStorage(op.source, instruction.operands);

  if (value === undefined || !registers.hasStorageValue(op.source, instruction.operands)) {
    rewrite.ops.push(op);
  } else {
    if (sourceReg !== undefined) {
      state.tracked.recordRegisterRead(sourceReg);
    }

    assignJitValue(rewrite, op.dst, value);
  }

  state.recordOpValue(op, instruction);
}

function emitPlannedRegisterAddress32(
  op: Extract<JitIrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): void {
  const { registers } = state.tracked;
  const value = registers.valueForEffectiveAddress(op.operand, instruction.operands);
  const readRegs = registers.regsReadByEffectiveAddress(op.operand, instruction.operands);

  if (value === undefined) {
    syncRegisterReadCounts(registers);
    state.recordOpValue(op, instruction);
    rewrite.ops.push(op);
    return;
  }

  for (const reg of readRegs) {
    state.tracked.recordRegisterRead(reg);
  }

  state.recordOpValue(op, instruction);
}

function emitPlannedRegisterSet32(
  op: Extract<JitIrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState,
  records: readonly JitOptimizationPlanRecord[]
): number {
  const target = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);

  syncRegisterReadCounts(state.tracked.registers);

  if (hasPlannedDrop(records, "registers", "set32")) {
    if (target === undefined || value === undefined) {
      throw new Error("planned register set32 drop requires a tracked target value");
    }

    state.tracked.recordRegisterValue(target, value);
    return 1;
  }

  if (target !== undefined) {
    state.tracked.recordClobber(jitTrackedRegisterLocation(target));
  }

  rewrite.ops.push(op);
  return 0;
}

function emitPlannedRegisterSet32If(
  op: Extract<JitIrOp, { op: "set32.if" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): void {
  const target = jitStorageReg(op.target, instruction.operands);

  if (target !== undefined) {
    state.tracked.recordClobber(jitTrackedRegisterLocation(target));
  }

  syncRegisterReadCounts(state.tracked.registers);
  rewrite.ops.push(op);
}

function materializePlannedRegisterValues(
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState,
  records: readonly JitOptimizationPlanRecord[],
  phase: "prelude" | "beforeOp" | "beforeExit"
): number {
  const locations = records
    .flatMap((record) =>
      record.kind === "materialization" &&
      record.domain === "registers" &&
      record.phase === phase
        ? [record.location]
        : []
    );

  if (locations.length === 0) {
    return 0;
  }

  return state.tracked.materializeRequiredLocations(rewrite, {
    kind: "locations",
    reason: "read",
    locations
  });
}
