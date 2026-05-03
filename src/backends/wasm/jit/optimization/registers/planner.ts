import type { StorageRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitPlannerInstructionContext, JitPlannerOpContext } from "#backends/wasm/jit/optimization/planner/domain.js";
import type {
  JitOptimizationPlanRecord,
  PlannedMaterialization
} from "#backends/wasm/jit/optimization/planner/plan.js";
import { costPolicyForcesRegisterMaterialization } from "#backends/wasm/jit/optimization/planner/policy.js";
import {
  repeatedEffectiveAddressReadMaterializationLocations,
  shouldRetainRegisterValue,
  syncRegisterReadCounts
} from "#backends/wasm/jit/optimization/registers/policy.js";
import {
  jitTrackedRegisterLocation,
  type JitTrackedLocation
} from "#backends/wasm/jit/optimization/tracked/state.js";
import { jitStorageReg } from "#backends/wasm/jit/optimization/ir/values.js";

export type JitRegisterPlannerResult = Readonly<{
  handled: boolean;
  producerCount: number;
  readCount: number;
  clobberCount: number;
  materializedSetCount: number;
}>;

const unhandledRegisterPlannerResult: JitRegisterPlannerResult = {
  handled: false,
  producerCount: 0,
  readCount: 0,
  clobberCount: 0,
  materializedSetCount: 0
};

export function planRegisterInstructionEntry(
  context: JitPlannerInstructionContext,
  records: JitOptimizationPlanRecord[]
): number {
  return recordRegisterMaterializations(
    records,
    context.instructionIndex,
    undefined,
    context.state.tracked.recordRegistersForPreInstructionExits(context.instructionIndex),
    "prelude",
    "preInstructionExit"
  );
}

export function planRegisterPostInstructionExit(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[]
): number {
  return recordRegisterMaterializations(
    records,
    context.instructionIndex,
    context.opIndex,
    context.state.tracked.recordRegistersForPostInstructionExit(
      context.instructionIndex,
      context.opIndex
    ),
    "beforeExit",
    "exit"
  );
}

export function planRegisterOp(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[]
): JitRegisterPlannerResult {
  const { instruction, instructionIndex, op, opIndex, state } = context;

  switch (op.op) {
    case "get32": {
      const result = planRegisterGet32(context, records, op);

      state.recordOpValue(op, instruction);
      return result;
    }
    case "address32": {
      const result = planRegisterAddress32(context, records, op);

      state.recordOpValue(op, instruction);
      return result;
    }
    case "set32":
      return {
        handled: true,
        readCount: 0,
        clobberCount: recordRegisterClobberCount(records, instructionIndex, opIndex, op.target, instruction),
        materializedSetCount: planRegisterSet32Clobber(context, records, op.target),
        producerCount: planRegisterSet32Producer(context, records, op)
      };
    case "set32.if":
      return {
        handled: true,
        producerCount: 0,
        readCount: 0,
        clobberCount: recordRegisterClobberCount(records, instructionIndex, opIndex, op.target, instruction),
        materializedSetCount: planRegisterSet32IfClobber(context, records, op.target)
      };
    default:
      return unhandledRegisterPlannerResult;
  }
}

function planRegisterGet32(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  op: Extract<JitIrOp, { op: "get32" }>
): JitRegisterPlannerResult {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(op.source, instruction.operands);
  const value = state.tracked.registers.valueForStorage(op.source, instruction.operands);

  if (
    reg === undefined ||
    value === undefined ||
    !state.tracked.registers.hasStorageValue(op.source, instruction.operands)
  ) {
    return {
      ...unhandledRegisterPlannerResult,
      handled: true
    };
  }

  const location = jitTrackedRegisterLocation(reg);

  if (costPolicyForcesRegisterMaterialization(reg, value, state.tracked.registers)) {
    pushRegisterReadRecord(
      state,
      records,
      instructionIndex,
      opIndex,
      location,
      false
    );
    return {
      handled: true,
      producerCount: 0,
      readCount: 1,
      clobberCount: 0,
      materializedSetCount: recordRegisterMaterializations(
        records,
        instructionIndex,
        opIndex,
        state.tracked.recordRequiredMaterializations({
          kind: "locations",
          reason: "read",
          locations: [location]
        }),
        "beforeOp",
        "policy"
      )
    };
  }

  pushRegisterReadRecord(
    state,
    records,
    instructionIndex,
    opIndex,
    location,
    true
  );
  return {
    handled: true,
    producerCount: 0,
    readCount: 1,
    clobberCount: 0,
    materializedSetCount: 0
  };
}

function planRegisterAddress32(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  op: Extract<JitIrOp, { op: "address32" }>
): JitRegisterPlannerResult {
  const { instruction, instructionIndex, opIndex, state } = context;
  let readCount = 0;
  let materializedSetCount = recordRegisterMaterializations(
    records,
    instructionIndex,
    opIndex,
    state.tracked.recordRequiredMaterializations({
      kind: "locations",
      reason: "read",
      locations: repeatedEffectiveAddressReadMaterializationLocations(
        op,
        instruction,
        state.tracked
      )
    }),
    "beforeOp",
    "policy"
  );
  const value = state.tracked.registers.valueForEffectiveAddress(op.operand, instruction.operands);
  const readRegs = state.tracked.registers.regsReadByEffectiveAddress(op.operand, instruction.operands);

  if (value === undefined) {
    const readLocations = readRegs
      .filter((reg) => state.tracked.registers.has(reg))
      .map(jitTrackedRegisterLocation);

    for (const location of readLocations) {
      pushRegisterReadRecord(state, records, instructionIndex, opIndex, location, false);
      readCount += 1;
    }

    materializedSetCount += recordRegisterMaterializations(
      records,
      instructionIndex,
      opIndex,
      state.tracked.recordRequiredMaterializations({
        kind: "locations",
        reason: "read",
        locations: readLocations
      }),
      "beforeOp",
      "read"
    );
    syncRegisterReadCounts(state.tracked.registers);
    return {
      handled: true,
      producerCount: 0,
      readCount,
      clobberCount: 0,
      materializedSetCount
    };
  }

  for (const reg of readRegs) {
    pushRegisterReadRecord(
      state,
      records,
      instructionIndex,
      opIndex,
      jitTrackedRegisterLocation(reg),
      true
    );
    readCount += 1;
  }

  return {
    handled: true,
    producerCount: 0,
    readCount,
    clobberCount: 0,
    materializedSetCount
  };
}

function planRegisterSet32Clobber(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  storage: StorageRef
): number {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return 0;
  }

  const location = jitTrackedRegisterLocation(reg);
  const materializedSetCount = recordRegisterMaterializations(
    records,
    instructionIndex,
    opIndex,
    state.tracked.recordRequiredMaterializations({
      kind: "registerDependencies",
      reason: "clobber",
      reg
    }),
    "beforeOp",
    "clobber"
  );

  state.tracked.recordClobber(location);
  syncRegisterReadCounts(state.tracked.registers);
  return materializedSetCount;
}

function planRegisterSet32IfClobber(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  storage: StorageRef
): number {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return 0;
  }

  const location = jitTrackedRegisterLocation(reg);
  let materializedSetCount = 0;

  if (state.tracked.registers.has(reg)) {
    pushRegisterReadRecord(state, records, instructionIndex, opIndex, location, false);
    materializedSetCount += recordRegisterMaterializations(
      records,
      instructionIndex,
      opIndex,
      state.tracked.recordRequiredMaterializations({
        kind: "locations",
        reason: "read",
        locations: [location]
      }),
      "beforeOp",
      "read"
    );
  }

  materializedSetCount += recordRegisterMaterializations(
    records,
    instructionIndex,
    opIndex,
    state.tracked.recordRequiredMaterializations({
      kind: "registerDependencies",
      reason: "clobber",
      reg
    }),
    "beforeOp",
    "clobber"
  );
  state.tracked.recordClobber(location);
  syncRegisterReadCounts(state.tracked.registers);
  return materializedSetCount;
}

function recordRegisterClobberCount(
  records: JitOptimizationPlanRecord[],
  instructionIndex: number,
  opIndex: number,
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): number {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return 0;
  }

  records.push({
    kind: "clobber",
    domain: "registers",
    instructionIndex,
    opIndex,
    location: jitTrackedRegisterLocation(reg),
    reg,
    reason: "write"
  });
  return 1;
}

function planRegisterSet32Producer(
  context: JitPlannerOpContext,
  records: JitOptimizationPlanRecord[],
  op: Extract<JitIrOp, { op: "set32" }>
): number {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);

  if (reg === undefined) {
    return 0;
  }

  const location = jitTrackedRegisterLocation(reg);

  if (value === undefined || !shouldRetainRegisterValue(value)) {
    records.push({
      kind: "materialization",
      domain: "registers",
      instructionIndex,
      opIndex,
      location,
      phase: "atOp",
      reason: "policy"
    });
    return 0;
  }

  state.tracked.recordRegisterValue(reg, value);
  records.push({
    kind: "producer",
    domain: "registers",
    instructionIndex,
    opIndex,
    location,
    producer: { kind: "registerValue", value }
  }, {
    kind: "fold",
    domain: "registers",
    instructionIndex,
    opIndex,
    location,
    foldKind: "registerValue"
  }, {
    kind: "drop",
    domain: "registers",
    instructionIndex,
    opIndex,
    op: "set32",
    reason: "folded"
  });
  return 1;
}

function pushRegisterReadRecord(
  state: JitPlannerOpContext["state"],
  records: JitOptimizationPlanRecord[],
  instructionIndex: number,
  opIndex: number,
  location: JitTrackedLocation,
  countRead: boolean
): void {
  if (location.kind !== "register") {
    throw new Error("register read record expected a register location");
  }

  const read = countRead
    ? state.tracked.recordRegisterRead(location.reg)
    : state.tracked.recordRead({ location, reason: "read" });

  records.push({
    kind: "read",
    domain: "registers",
    instructionIndex,
    opIndex,
    location: read.location,
    reason: read.reason,
    read
  });
}

function recordRegisterMaterializations(
  records: JitOptimizationPlanRecord[],
  instructionIndex: number,
  opIndex: number | undefined,
  locations: readonly JitTrackedLocation[],
  phase: PlannedMaterialization["phase"],
  reason: PlannedMaterialization["reason"]
): number {
  records.push(...locations.map((location) => ({
    kind: "materialization" as const,
    domain: "registers" as const,
    instructionIndex,
    ...(opIndex === undefined ? {} : { opIndex }),
    location,
    phase,
    reason
  })));

  return locations.filter((location) => location.kind === "register").length;
}
