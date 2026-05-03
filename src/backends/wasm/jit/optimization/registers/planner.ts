import type { StorageRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type {
  JitPlannerFact,
  JitPlannerInstructionContext,
  JitPlannerOpContext
} from "#backends/wasm/jit/optimization/planner/domain.js";
import type { PlannedMaterialization } from "#backends/wasm/jit/optimization/planner/plan.js";
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

export type JitRegisterPlannerMaterializationResult = Readonly<{
  facts: readonly JitPlannerFact[];
  materializedSetCount: number;
}>;

export type JitRegisterPlannerResult = Readonly<{
  handled: boolean;
  facts: readonly JitPlannerFact[];
  producerCount: number;
  readCount: number;
  clobberCount: number;
  materializedSetCount: number;
}>;

const unhandledRegisterPlannerResult: JitRegisterPlannerResult = {
  handled: false,
  facts: [],
  producerCount: 0,
  readCount: 0,
  clobberCount: 0,
  materializedSetCount: 0
};

export function planRegisterInstructionEntry(
  context: JitPlannerInstructionContext
): JitRegisterPlannerMaterializationResult {
  return registerMaterializationPlan(
    context.instructionIndex,
    undefined,
    context.state.tracked.recordRegistersForPreInstructionExits(context.instructionIndex),
    "prelude",
    "preInstructionExit"
  );
}

export function planRegisterPostInstructionExit(
  context: JitPlannerOpContext
): JitRegisterPlannerMaterializationResult {
  return registerMaterializationPlan(
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
  context: JitPlannerOpContext
): JitRegisterPlannerResult {
  const { instruction, instructionIndex, op, opIndex, state } = context;

  switch (op.op) {
    case "get32": {
      const result = planRegisterGet32(context, op);

      state.recordOpValue(op, instruction);
      return result;
    }
    case "address32": {
      const result = planRegisterAddress32(context, op);

      state.recordOpValue(op, instruction);
      return result;
    }
    case "set32": {
      const clobberFacts = registerWriteClobberFacts(instructionIndex, opIndex, op.target, instruction);
      const clobber = planRegisterSet32Clobber(context, op.target);
      const producer = planRegisterSet32Producer(context, op);

      return {
        handled: true,
        facts: [...clobberFacts, ...clobber.facts, ...producer.facts],
        readCount: 0,
        clobberCount: clobberFacts.length,
        materializedSetCount: clobber.materializedSetCount + producer.materializedSetCount,
        producerCount: producer.producerCount
      };
    }
    case "set32.if": {
      const clobberFacts = registerWriteClobberFacts(instructionIndex, opIndex, op.target, instruction);
      const clobber = planRegisterSet32IfClobber(context, op.target);

      return {
        handled: true,
        facts: [...clobberFacts, ...clobber.facts],
        producerCount: 0,
        readCount: 0,
        clobberCount: clobberFacts.length,
        materializedSetCount: clobber.materializedSetCount
      };
    }
    default:
      return unhandledRegisterPlannerResult;
  }
}

function planRegisterGet32(
  context: JitPlannerOpContext,
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
    const materialization = registerMaterializationPlan(
      instructionIndex,
      opIndex,
      state.tracked.recordRequiredMaterializations({
        kind: "locations",
        reason: "read",
        locations: [location]
      }),
      "beforeOp",
      "policy"
    );

    return {
      handled: true,
      facts: [
        registerReadFact(state, instructionIndex, opIndex, location, false),
        ...materialization.facts
      ],
      producerCount: 0,
      readCount: 1,
      clobberCount: 0,
      materializedSetCount: materialization.materializedSetCount
    };
  }

  return {
    handled: true,
    facts: [registerReadFact(state, instructionIndex, opIndex, location, true)],
    producerCount: 0,
    readCount: 1,
    clobberCount: 0,
    materializedSetCount: 0
  };
}

function planRegisterAddress32(
  context: JitPlannerOpContext,
  op: Extract<JitIrOp, { op: "address32" }>
): JitRegisterPlannerResult {
  const { instruction, instructionIndex, opIndex, state } = context;
  const repeatedReadMaterialization = registerMaterializationPlan(
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
    const readFacts = readLocations.map((location) =>
      registerReadFact(state, instructionIndex, opIndex, location, false)
    );
    const readMaterialization = registerMaterializationPlan(
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
      facts: [
        ...repeatedReadMaterialization.facts,
        ...readFacts,
        ...readMaterialization.facts
      ],
      producerCount: 0,
      readCount: readFacts.length,
      clobberCount: 0,
      materializedSetCount: repeatedReadMaterialization.materializedSetCount +
        readMaterialization.materializedSetCount
    };
  }

  const readFacts = readRegs.map((reg) =>
    registerReadFact(
      state,
      instructionIndex,
      opIndex,
      jitTrackedRegisterLocation(reg),
      true
    )
  );

  return {
    handled: true,
    facts: [...repeatedReadMaterialization.facts, ...readFacts],
    producerCount: 0,
    readCount: readFacts.length,
    clobberCount: 0,
    materializedSetCount: repeatedReadMaterialization.materializedSetCount
  };
}

function planRegisterSet32Clobber(
  context: JitPlannerOpContext,
  storage: StorageRef
): JitRegisterPlannerMaterializationResult {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return emptyRegisterMaterializationResult;
  }

  const location = jitTrackedRegisterLocation(reg);
  const materialization = registerMaterializationPlan(
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
  return materialization;
}

function planRegisterSet32IfClobber(
  context: JitPlannerOpContext,
  storage: StorageRef
): JitRegisterPlannerMaterializationResult {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return emptyRegisterMaterializationResult;
  }

  const location = jitTrackedRegisterLocation(reg);
  const facts: JitPlannerFact[] = [];
  let materializedSetCount = 0;

  if (state.tracked.registers.has(reg)) {
    facts.push(registerReadFact(state, instructionIndex, opIndex, location, false));
    const readMaterialization = registerMaterializationPlan(
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

    facts.push(...readMaterialization.facts);
    materializedSetCount += readMaterialization.materializedSetCount;
  }

  const dependencyMaterialization = registerMaterializationPlan(
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

  facts.push(...dependencyMaterialization.facts);
  materializedSetCount += dependencyMaterialization.materializedSetCount;
  state.tracked.recordClobber(location);
  syncRegisterReadCounts(state.tracked.registers);
  return { facts, materializedSetCount };
}

function registerWriteClobberFacts(
  instructionIndex: number,
  opIndex: number,
  storage: StorageRef,
  instruction: JitIrBlockInstruction
): readonly JitPlannerFact[] {
  const reg = jitStorageReg(storage, instruction.operands);

  if (reg === undefined) {
    return [];
  }

  return [{
    kind: "clobber",
    domain: "registers",
    instructionIndex,
    opIndex,
    location: jitTrackedRegisterLocation(reg),
    reg,
    reason: "write"
  }];
}

function planRegisterSet32Producer(
  context: JitPlannerOpContext,
  op: Extract<JitIrOp, { op: "set32" }>
): Readonly<{
  facts: readonly JitPlannerFact[];
  producerCount: number;
  materializedSetCount: number;
}> {
  const { instruction, instructionIndex, opIndex, state } = context;
  const reg = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);

  if (reg === undefined) {
    return emptyRegisterProducerResult;
  }

  const location = jitTrackedRegisterLocation(reg);

  if (value === undefined || !shouldRetainRegisterValue(value)) {
    return {
      facts: [{
        kind: "emissionNeed",
        domain: "registers",
        instructionIndex,
        opIndex,
        location,
        phase: "atOp",
        reason: "policy"
      }],
      producerCount: 0,
      materializedSetCount: 0
    };
  }

  state.tracked.recordRegisterValue(reg, value);
  return {
    facts: [{
      kind: "producer",
      domain: "registers",
      instructionIndex,
      opIndex,
      location,
      producer: { kind: "registerValue", value }
    }, {
      kind: "foldableUse",
      domain: "registers",
      instructionIndex,
      opIndex,
      location,
      useKind: "value"
    }, {
      kind: "droppableProducer",
      domain: "registers",
      instructionIndex,
      opIndex,
      location,
      operation: "set32",
      reason: "folded"
    }],
    producerCount: 1,
    materializedSetCount: 0
  };
}

function registerReadFact(
  state: JitPlannerOpContext["state"],
  instructionIndex: number,
  opIndex: number,
  location: JitTrackedLocation,
  countRead: boolean
): JitPlannerFact {
  if (location.kind !== "register") {
    throw new Error("register read fact expected a register location");
  }

  const read = countRead
    ? state.tracked.recordRegisterRead(location.reg)
    : state.tracked.recordRead({ location, reason: "read" });

  return {
    kind: "read",
    domain: "registers",
    instructionIndex,
    opIndex,
    location: read.location,
    reason: read.reason,
    read
  };
}

function registerMaterializationPlan(
  instructionIndex: number,
  opIndex: number | undefined,
  locations: readonly JitTrackedLocation[],
  phase: PlannedMaterialization["phase"],
  reason: PlannedMaterialization["reason"]
): JitRegisterPlannerMaterializationResult {
  return {
    facts: locations.length === 0
      ? []
      : [{
          kind: "materializationBoundary",
          domain: "registers",
          instructionIndex,
          ...(opIndex === undefined ? {} : { opIndex }),
          locations,
          phase,
          reason
        }],
    materializedSetCount: locations.filter((location) => location.kind === "register").length
  };
}

const emptyRegisterMaterializationResult: JitRegisterPlannerMaterializationResult = {
  facts: [],
  materializedSetCount: 0
};

const emptyRegisterProducerResult = {
  facts: [],
  producerCount: 0,
  materializedSetCount: 0
} as const;
