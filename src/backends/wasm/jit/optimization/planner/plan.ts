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
  | JitOptimizationProducerRecord
  | JitOptimizationReadRecord
  | JitOptimizationClobberRecord
  | JitOptimizationFoldRecord
  | JitOptimizationMaterializationRecord
  | JitOptimizationRewriteRecord
  | JitOptimizationDropRecord;

export type JitOptimizationProducerRecord = Readonly<{
  kind: "producer";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  location: JitTrackedLocation;
  producer: JitTrackedProducer;
}>;

export type JitOptimizationReadRecord = Readonly<{
  kind: "read";
  domain: "flags" | "registers";
  instructionIndex?: number;
  opIndex?: number;
  read: JitTrackedRead;
}>;

export type JitOptimizationClobberRecord = Readonly<{
  kind: "clobber";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  location: JitTrackedLocation;
  reg?: Reg32;
}>;

export type JitOptimizationFoldRecord = Readonly<{
  kind: "fold";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  reason: "condition" | "read";
}>;

export type JitOptimizationMaterializationRecord = Readonly<{
  kind: "materialization";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex?: number;
  reason: JitTrackedMaterializationReason;
  location?: JitTrackedLocation;
  count: number;
}>;

export type JitOptimizationRewriteRecord = Readonly<{
  kind: "rewrite";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  op: "jit.flagCondition" | "set32" | "value";
}>;

export type JitOptimizationDropRecord = Readonly<{
  kind: "drop";
  domain: "flags" | "registers";
  instructionIndex: number;
  opIndex: number;
  op: "flags.set" | "set32";
}>;

export type JitOptimizationPlan = Readonly<{
  block: JitIrBlock;
  records: readonly JitOptimizationPlanRecord[];
  stats: JitTrackedOptimizationStats;
}>;
