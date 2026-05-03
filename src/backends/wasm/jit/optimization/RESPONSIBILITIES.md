# JIT Optimization Responsibility Survey

This records the pre-shared-tracking responsibilities for the optimizer passes.
It is intended to keep the first shared-model slices behavior-preserving.

## flag-analysis.ts

- Reads: records condition, explicit materialize/boundary, pre-instruction exit,
  and post-instruction exit flag reads with the owners visible at that point.
- Writes: records `flags.set` ops as flag sources.
- Clobbers: records register writes that would clobber inputs captured by a
  pending flag producer.
- Producer ownership: owns the flag owner walk through `JitFlagOwners`, with
  incoming, materialized, and producer owners.
- Materialization: records explicit materialize/boundary ops as materialized
  owners for later reads; it does not rewrite IR.
- Rewrite/drop decisions: none; this pass only returns source/read/clobber
  analysis for the materialization pass.

## flag-materialization.ts

- Reads: consumes reads from `analyzeJitFlags`.
- Writes: does not create new flag sources; it indexes existing sources.
- Clobbers: reports source clobber count from analysis.
- Producer ownership: decides which producer source ids are still needed after
  direct condition planning.
- Materialization: preserves needed `flags.set` ops and direct condition input
  loads.
- Rewrite/drop decisions: drops unneeded `flags.set` ops and rewrites supported
  `aluFlags.condition` ops into `jit.flagCondition`.

## register-folding.ts

- Reads: handles register gets, effective address reads, and exit reads through
  the register rewrite helpers and materialization helpers.
- Writes: records foldable `set32` values into `JitRegisterValues`.
- Clobbers: delegates register write clobber handling to register rewrite
  helpers.
- Producer ownership: owns the register value walk for the pass through
  `JitOptimizationState.registers`.
- Materialization: materializes pending register values before pre-instruction
  exits, post-instruction exits, repeated reads, and clobbers.
- Rewrite/drop decisions: removes foldable `set32` ops, emits materialized
  `set32` ops when required, and rewrites reads/address calculations when a
  tracked value can be substituted.

## register-materialization.ts

- Reads: materializes register values required by explicit register reads,
  effective-address reads, pre-instruction exits, and post-instruction exits.
- Writes: emits concrete `set32` ops for tracked register values.
- Clobbers: materializes values that depend on a register before that register
  is overwritten.
- Producer ownership: consumes `JitRegisterValues` entries.
- Materialization: owns the register materialization routines shared by
  register folding.
- Rewrite/drop decisions: no independent drop logic; callers decide whether an
  original op is retained after materialization.

## state.ts

- Reads: provides per-instruction value tracking used by both flag and register
  analysis.
- Writes: groups the current instruction value tracker, register value tracker,
  and flag owner tracker.
- Clobbers: does not directly handle clobbers.
- Producer ownership: exposes separate register and flag owner systems.
- Materialization: does not materialize directly.
- Rewrite/drop decisions: creates instruction rewrites and records local values;
  pass-specific helpers make drop decisions.

## effects.ts

- Reads: exposes indexed pre-instruction exits, post-instruction exits,
  condition uses, and condition value reads for passes.
- Writes: no optimizer state writes.
- Clobbers: no clobber handling.
- Producer ownership: no producer tracking.
- Materialization: tells consumers where exit-driven materialization is
  required.
- Rewrite/drop decisions: none; it is an effect index/facade over block
  semantics.
