# JIT Optimizer Architecture

The tracked optimizer uses one architecture for flags and registers:

1. Producers are recorded when an instruction creates a tracked register value
   or a tracked flag source.
2. Reads record which tracked producers are visible at the read location.
3. Clobbers invalidate tracked producers whose inputs are no longer safe.
4. The planner decides whether each producer is folded, materialized, or kept.
5. The emitter rewrites the IR from the plan and drops producers that no longer
   need a concrete operation.

`pipeline.ts` is the public optimization entry point. It keeps the public result
shape stable while delegating optimization to the planner and emitter. The pass
order remains `["tracked-optimization"]`.

## Production Files

- `pipeline.ts`: public pass order and pipeline result shape.
- `optimize.ts`: public block optimization entry point.
- `tracked/state.ts` and `tracked/types.ts`: shared producer, read, clobber,
  and materialization state.
- `planner/plan.ts`: immutable plan records for producers, reads, clobbers,
  folds, materializations, rewrites, drops, and stats.
- `planner/domain.ts`: shared domain adapter contract for reporting normalized
  producers, reads, clobbers, boundaries, foldable uses, droppable producers,
  and emission needs before shared decisions are applied.
- `planner/decisions.ts`: shared fact-to-plan decision layer that materializes
  normalized facts into folds, drops, clobbers, reads, rewrites, and emitted
  materialization records.
- `planner/planner.ts`: one forward walk over `JitTrackedState` that records
  normalized domain facts and applies shared decisions without emitting IR.
- `planner/emitter.ts`: emits optimized IR from the plan.
- `planner/policy.ts`: shared policy that coordinates register and flag
  decisions, including register writes that invalidate flag source inputs.
- `planner/stats.ts`: public counters reported through the existing pass result
  shape.
- `flags/sources.ts`, `flags/owners.ts`, `flags/conditions.ts`,
  `flags/planner.ts`, `flags/policy.ts`, and `flags/materialization.ts`: flag
  source ownership, normalized flag fact discovery, direct condition planning,
  and thin compatibility helpers.
- `registers/values.ts`, `registers/planner.ts`, and `registers/policy.ts`:
  register value tracking, normalized register fact discovery, and policy.
- `effects/`: indexed side-effect and exit metadata used by the planner.
- `ir/`: IR walking, ranges, values, operand binding, and rewrite primitives.
- `passes/`: compatibility wrappers for legacy public helper names that now
  delegate to the planner/emitter model.

## Helper Files

- Test builders and assertions under `tests/helpers.ts`.
- Local IR helpers that are only used by tests remain test-only even when they
  import production types.

## Historical Cleanup

- Earlier transitional optimizer entry points have been collapsed into
  `planner/planner.ts` and `planner/emitter.ts`.
- Flag and register compatibility entry points are thin wrappers over the
  shared planner/emitter path.
- The tracked state model lives in `tracked/state.ts` and `tracked/types.ts`.
- `RESPONSIBILITIES.md` is removed; this document is the architecture source.
