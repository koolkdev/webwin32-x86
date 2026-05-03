import type {
  JitPlannerClobberFact,
  JitPlannerDomainId,
  JitPlannerDroppableProducerFact,
  JitPlannerEmissionNeedFact,
  JitPlannerFact,
  JitPlannerFoldableUseFact,
  JitPlannerMaterializationBoundaryFact,
  JitPlannerProducerFact,
  JitPlannerReadFact,
  JitPlannerRewriteFact
} from "#backends/wasm/jit/optimization/planner/domain.js";
import type {
  JitOptimizationPlanRecord,
  PlannedDrop,
  PlannedFold,
  PlannedMaterialization,
  PlannedProducer,
  PlannedRead,
  PlannedRewrite
} from "#backends/wasm/jit/optimization/planner/plan.js";
import {
  mustMaterializePlannedProducer,
  shouldDropPlannedProducer
} from "#backends/wasm/jit/optimization/planner/policy.js";
import type { JitTrackedLocation } from "#backends/wasm/jit/optimization/tracked/state.js";

export function recordJitPlannerFacts(
  records: JitOptimizationPlanRecord[],
  facts: readonly JitPlannerFact[]
): void {
  records.push(...decideJitPlannerFacts(facts));
}

export function decideJitPlannerFacts(
  facts: readonly JitPlannerFact[]
): readonly JitOptimizationPlanRecord[] {
  const records: JitOptimizationPlanRecord[] = [];

  for (const fact of facts) {
    records.push(...decideJitPlannerFact(fact));
  }

  return records;
}

function decideJitPlannerFact(fact: JitPlannerFact): readonly JitOptimizationPlanRecord[] {
  switch (fact.kind) {
    case "producer":
      return [plannedProducerRecord(fact)];
    case "read":
      return [plannedReadRecord(fact)];
    case "clobber":
      return [plannedClobberRecord(fact)];
    case "materializationBoundary":
      return plannedMaterializationBoundaryRecords(fact);
    case "foldableUse":
      return [plannedFoldRecord(fact)];
    case "droppableProducer":
      return plannedDropRecord(fact);
    case "emissionNeed":
      return plannedEmissionNeedRecord(fact);
    case "rewrite":
      return [plannedRewriteRecord(fact)];
  }
}

function plannedProducerRecord(fact: JitPlannerProducerFact): PlannedProducer {
  return {
    kind: "producer",
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    opIndex: fact.opIndex,
    location: fact.location,
    producer: fact.producer
  };
}

function plannedReadRecord(fact: JitPlannerReadFact): PlannedRead {
  return {
    kind: "read",
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    opIndex: fact.opIndex,
    location: fact.location,
    reason: fact.reason,
    read: fact.read
  };
}

function plannedClobberRecord(fact: JitPlannerClobberFact): JitOptimizationPlanRecord {
  return {
    kind: "clobber",
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    opIndex: fact.opIndex,
    location: fact.location,
    ...(fact.reg === undefined ? {} : { reg: fact.reg }),
    reason: fact.reason
  };
}

function plannedMaterializationBoundaryRecords(
  fact: JitPlannerMaterializationBoundaryFact
): readonly PlannedMaterialization[] {
  return fact.locations
    .map((location) => plannedMaterializationRecord(fact, location))
    .filter(mustMaterializePlannedProducer);
}

function plannedEmissionNeedRecord(
  fact: JitPlannerEmissionNeedFact
): readonly PlannedMaterialization[] {
  const materialization = plannedMaterializationRecord(fact, fact.location);

  return mustMaterializePlannedProducer(materialization) ? [materialization] : [];
}

function plannedMaterializationRecord(
  fact: JitPlannerMaterializationBoundaryFact | JitPlannerEmissionNeedFact,
  location: JitTrackedLocation
): PlannedMaterialization {
  return {
    kind: "materialization",
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    ...(fact.opIndex === undefined ? {} : { opIndex: fact.opIndex }),
    location,
    phase: fact.phase,
    reason: fact.reason
  };
}

function plannedFoldRecord(fact: JitPlannerFoldableUseFact): PlannedFold {
  return {
    kind: "fold",
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    opIndex: fact.opIndex,
    location: fact.location,
    foldKind: plannedFoldKind(fact)
  };
}

function plannedDropRecord(fact: JitPlannerDroppableProducerFact): readonly PlannedDrop[] {
  const drop = {
    kind: "drop" as const,
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    opIndex: fact.opIndex,
    op: plannedDropOp(fact.operation),
    reason: fact.reason
  };

  return shouldDropPlannedProducer(drop) ? [drop] : [];
}

function plannedRewriteRecord(fact: JitPlannerRewriteFact): PlannedRewrite {
  return {
    kind: "rewrite",
    domain: plannedDomain(fact.domain),
    instructionIndex: fact.instructionIndex,
    opIndex: fact.opIndex,
    rewriteKind: fact.rewriteKind,
    op: fact.operation
  };
}

function plannedDomain(domain: JitPlannerDomainId): PlannedProducer["domain"] {
  switch (domain) {
    case "flags":
    case "registers":
      return domain;
    default:
      throw new Error(`unknown JIT planner domain: ${domain}`);
  }
}

function plannedFoldKind(fact: JitPlannerFoldableUseFact): PlannedFold["foldKind"] {
  switch (fact.useKind) {
    case "value":
      return "registerValue";
    case "condition":
      return "flagCondition";
  }
}

function plannedDropOp(operation: string): PlannedDrop["op"] {
  switch (operation) {
    case "flags.set":
    case "set32":
      return operation;
    default:
      throw new Error(`unknown JIT planner droppable producer operation: ${operation}`);
  }
}
