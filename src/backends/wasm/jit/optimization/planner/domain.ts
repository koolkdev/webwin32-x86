import type {
  JitIrBlock,
  JitIrBlockInstruction,
  JitIrOp
} from "#backends/wasm/jit/types.js";
import type { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import type {
  JitTrackedLocation,
  JitTrackedMaterializationReason,
  JitTrackedProducer,
  JitTrackedRead
} from "#backends/wasm/jit/optimization/tracked/state.js";
import type {
  PlannedClobber,
  PlannedDrop,
  PlannedMaterialization
} from "#backends/wasm/jit/optimization/planner/plan.js";

export type JitPlannerDomainId = string;

export type JitPlannerPoint = Readonly<{
  instructionIndex: number;
  opIndex?: number;
}>;

export type JitPlannerAdapterContext = Readonly<{
  block: JitIrBlock;
  state: JitOptimizationState;
}>;

export type JitPlannerInstructionContext = JitPlannerAdapterContext & Readonly<{
  instruction: JitIrBlockInstruction;
  instructionIndex: number;
}>;

export type JitPlannerOpContext = JitPlannerInstructionContext & Readonly<{
  op: JitIrOp;
  opIndex: number;
}>;

export type JitPlannerDomainAdapter = Readonly<{
  domain: JitPlannerDomainId;
  beginInstruction?: (context: JitPlannerInstructionContext) => readonly JitPlannerFact[];
  visitOp: (context: JitPlannerOpContext) => readonly JitPlannerFact[];
  endInstruction?: (context: JitPlannerInstructionContext) => readonly JitPlannerFact[];
  finish?: (context: JitPlannerAdapterContext) => readonly JitPlannerFact[];
}>;

export type JitPlannerFact =
  | JitPlannerProducerFact
  | JitPlannerReadFact
  | JitPlannerClobberFact
  | JitPlannerMaterializationBoundaryFact
  | JitPlannerFoldableUseFact
  | JitPlannerDroppableProducerFact
  | JitPlannerEmissionNeedFact;

export type JitPlannerProducerFact = JitPlannerLocatedFact & Readonly<{
  kind: "producer";
  opIndex: number;
  producer: JitTrackedProducer;
}>;

export type JitPlannerReadFact = JitPlannerLocatedFact & Readonly<{
  kind: "read";
  opIndex: number;
  reason: JitTrackedMaterializationReason;
  read: JitTrackedRead;
}>;

export type JitPlannerClobberFact = JitPlannerLocatedFact & Readonly<{
  kind: "clobber";
  opIndex: number;
  reason: PlannedClobber["reason"];
}>;

export type JitPlannerMaterializationBoundaryFact = JitPlannerDomainFactBase & JitPlannerPoint & Readonly<{
  kind: "materializationBoundary";
  phase: PlannedMaterialization["phase"];
  reason: PlannedMaterialization["reason"];
  locations: readonly JitTrackedLocation[];
}>;

export type JitPlannerFoldableUseFact = JitPlannerLocatedFact & Readonly<{
  kind: "foldableUse";
  opIndex: number;
  useKind: "value" | "condition";
}>;

export type JitPlannerDroppableProducerFact = JitPlannerLocatedFact & Readonly<{
  kind: "droppableProducer";
  opIndex: number;
  operation: string;
  reason: PlannedDrop["reason"];
}>;

export type JitPlannerEmissionNeedFact = JitPlannerLocatedFact & Readonly<{
  kind: "emissionNeed";
  phase: PlannedMaterialization["phase"];
  reason: PlannedMaterialization["reason"];
}>;

export type JitPlannerDomainFactBase = Readonly<{
  domain: JitPlannerDomainId;
}>;

export type JitPlannerLocatedFact = JitPlannerDomainFactBase & JitPlannerPoint & Readonly<{
  instructionIndex: number;
  location: JitTrackedLocation;
}>;

export function jitPlannerPointKey(point: JitPlannerPoint): string {
  return point.opIndex === undefined
    ? `${point.instructionIndex}:prelude`
    : `${point.instructionIndex}:${point.opIndex}`;
}

export function jitPlannerFactsAt<TFact extends JitPlannerFact>(
  facts: readonly TFact[],
  point: JitPlannerPoint
): readonly TFact[] {
  return facts.filter((fact) =>
    fact.instructionIndex === point.instructionIndex &&
    fact.opIndex === point.opIndex
  );
}
