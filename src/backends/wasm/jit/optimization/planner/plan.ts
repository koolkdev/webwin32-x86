import type { Reg32 } from "#x86/isa/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import type {
  JitTrackedLocation,
  JitTrackedMaterializationReason,
  JitTrackedProducer,
  JitTrackedRead
} from "#backends/wasm/jit/optimization/tracked/state.js";
import type { JitTrackedOptimizationStats } from "#backends/wasm/jit/optimization/planner/stats.js";

export type JitOptimizationPlanRecord =
  | PlannedProducer
  | PlannedRead
  | PlannedClobber
  | PlannedFold
  | PlannedMaterialization
  | PlannedRewrite
  | PlannedDrop;

export type PlannedProducer = Readonly<{
  kind: "producer";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  location: JitTrackedLocation;
  producer: JitTrackedProducer;
}>;

export type PlannedRead = Readonly<{
  kind: "read";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  location: JitTrackedLocation;
  reason: JitTrackedMaterializationReason;
  read: JitTrackedRead;
}>;

export type PlannedClobber = Readonly<{
  kind: "clobber";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  location: JitTrackedLocation;
  reg?: Reg32;
  reason: "write" | "dependency";
}>;

export type PlannedFold = Readonly<{
  kind: "fold";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  location: JitTrackedLocation;
  foldKind: "registerValue" | "flagCondition";
}>;

export type PlannedMaterialization = Readonly<{
  kind: "materialization";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex?: number;
  location: JitTrackedLocation;
  phase: "prelude" | "beforeOp" | "atOp" | "beforeExit";
  reason: JitTrackedMaterializationReason | "policy";
}>;

export type PlannedRewrite = Readonly<{
  kind: "rewrite";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  rewriteKind: "replace" | "insertBefore" | "insertPrelude" | "keep";
  op: "jit.flagCondition" | "set32" | "value";
}>;

export type PlannedDrop = Readonly<{
  kind: "drop";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  op: "flags.set" | "set32";
  reason: "folded" | "unusedProducer";
}>;

export type JitOptimizationProducerRecord = PlannedProducer;
export type JitOptimizationReadRecord = PlannedRead;
export type JitOptimizationClobberRecord = PlannedClobber;
export type JitOptimizationFoldRecord = PlannedFold;
export type JitOptimizationMaterializationRecord = PlannedMaterialization;
export type JitOptimizationRewriteRecord = PlannedRewrite;
export type JitOptimizationDropRecord = PlannedDrop;

export type JitOptimizationPlan = Readonly<{
  block: JitIrBlock;
  records: readonly JitOptimizationPlanRecord[];
  stats: JitTrackedOptimizationStats;
}>;
