# JIT Optimizer Pass Pipeline Redesign Plan

This document describes how to replace the current tracked planner/emitter
optimizer with a conventional pass pipeline. The goal is not to preserve the
current architecture. The goal is to preserve the behavioral coverage and move
to a simpler optimizer where analyses are disposable, passes rewrite IR, and
lowering preparation is a separate final step.

## Why Change

The current optimizer centralizes register folding, flag folding, exit
materialization, and state snapshots through one shared planner model. That
model is too clever:

- It tries to make registers and flags look like the same domain even though
  their semantics are different.
- It creates plan records that are not self-contained enough to emit without
  recomputing side analyses.
- It uses old op indexes across multiple transformation phases.
- It makes materialization a planning concern instead of a normal IR rewrite.
- It hides lowering requirements inside optimization state.

The replacement should be boring. Each optimization pass should take a JIT IR
block and return a JIT IR block. Analyses should be recomputed when needed.
Exit state analysis and lowering decorations should happen after optimization,
not during it.

## Target Directory Structure

```txt
src/backends/wasm/jit/
  ir/
    types.ts
    walk.ts
    rewrite.ts
    validate.ts
    effects.ts
    values.ts
    storage.ts

  optimization/
    pipeline.ts
    pass.ts
    stats.ts

    analyses/
      local-liveness.ts
      flag-liveness.ts
      reaching-flags.ts
      register-values.ts
      barriers.ts

    passes/
      local-dce.ts
      flag-dce.ts
      flag-condition-specialization.ts
      register-value-propagation.ts
      cleanup.ts

    verify/
      optimizer-invariants.ts
      equivalence-checks.ts

    tests/
      helpers.ts
      pipeline.test.ts
      local-dce.test.ts
      flag-dce.test.ts
      flag-condition-specialization.test.ts
      register-value-propagation.test.ts
      optimizer-invariants.test.ts
      golden/
        flag-conditions.test.ts
        register-folding.test.ts
        memory-faults.test.ts
        partial-flags.test.ts

  lowering-prep/
    exit-state-analysis.ts
    flag-boundaries.ts
    register-exit-stores.ts
    lowering-block.ts
    tests/
      exit-state-analysis.test.ts
      flag-boundaries.test.ts

  lowering/
    ...
```

The important split is:

- `ir/`: JIT IR type definitions and general-purpose IR utilities.
- `optimization/`: pure IR-to-IR optimization.
- `lowering-prep/`: final analysis and decoration for Wasm lowering.
- `lowering/`: Wasm emission.

Do not recreate `optimization/planner/` or `optimization/tracked/`.

## Target Pass Interface

Create one small pass interface:

```ts
export type JitPassContext = Readonly<{
  validate?: boolean;
}>;

export type JitPassResult = Readonly<{
  block: JitIrBlock;
  changed: boolean;
  stats?: Readonly<Record<string, number>>;
}>;

export type JitOptimizationPass = Readonly<{
  name: string;
  run(block: JitIrBlock, context: JitPassContext): JitPassResult;
}>;
```

The pipeline should be plain orchestration:

```ts
const passes = [
  localDcePass,
  flagDcePass,
  flagConditionSpecializationPass,
  localDcePass,
  registerValuePropagationPass,
  localDcePass,
  cleanupPass
];
```

Every pass:

- Receives current IR.
- Computes whatever analysis it needs.
- Emits a new IR block.
- Does not return side tables needed by later passes.
- Does not rely on op indexes from earlier passes.

## Target IR Principles

Keep instruction boundaries. They are required for x86 EIP, instruction count,
and pre-instruction fault snapshots.

Prefer explicit side effects over side analyses where practical. A memory load
or store should make its fault behavior visible to verifiers and lowering prep.
If the current IR cannot represent that cleanly, add explicit metadata or
wrapper ops rather than relying on a separate effect index that can go stale.

The optimized IR should not contain `prelude`. Prelude-like work is lowering
prep, not optimization. Register materialization should appear as normal IR
ops before the operation or exit that requires it.

## Pass Responsibilities

### Local DCE

Purpose: remove unused local SSA values.

Inputs:

- JIT IR block.
- Operation purity and storage-read metadata.

Rules:

- Drop pure value ops whose `dst` is not live.
- Drop `get32` only when the storage read cannot fault.
- Never drop memory reads just because the result is dead.
- Never drop terminators or state-changing ops.

### Flag DCE

Purpose: delete unused deferred flag producers.

Inputs:

- Bit-level backward flag liveness.
- Flag producer write and undef masks.
- Flag reads from `aluFlags.condition`, `flags.materialize`,
  `flags.boundary`, and exits.

Rules:

- Track CF/PF/AF/ZF/SF/OF independently.
- Support partial writers such as `inc32` and `dec32`.
- Delete `flags.set` only when none of its written or undefined bits are live.
- Preserve producers needed by fault exits and control exits.

### Flag Condition Specialization

Purpose: replace `aluFlags.condition` with direct producer conditions where
safe.

Inputs:

- Reaching flag producer analysis.
- Register/input clobber checks.
- Flag condition model.

Rules:

- Specialize only when one compatible producer reaches the condition read.
- Refuse specialization if producer inputs were clobbered.
- For `sub32`, prefer direct left/right comparisons.
- For `logic32`, `inc32`, `dec32`, and result-only cases, specialize only when
  the modeled condition is supported.
- Do not delete the `flags.set` in this pass unless flag liveness says it is
  dead. Let `flag-dce` decide that.

### Register Value Propagation

Purpose: remove redundant register stores and fold register values into reads,
addresses, and exit targets.

Inputs:

- Forward symbolic register value environment.
- Barrier analysis.
- Register value cost policy.

Rules:

- Track symbolic values such as constants, registers, and cheap i32
  expressions.
- Replace `get32` from tracked registers with the symbolic value.
- Fold effective addresses when all required address terms are representable.
- Delete `set32` when the target register can remain virtual.
- Insert real `set32` materialization at barriers:
  - memory fault side exits,
  - control exits,
  - host traps,
  - block end,
  - writes that clobber a dependency,
  - conditional writes that require the old target value,
  - cost-policy boundaries for repeated expensive reads.
- Do not reason about flag producers here except through normal IR dependencies.

### Cleanup

Purpose: normalize final IR after optimization.

Rules:

- Remove trivial dead locals left by previous passes.
- Normalize value forms if needed.
- Keep one clear terminator shape per instruction.
- Do not do semantic optimization here.

## Lowering Prep Responsibilities

Lowering prep happens after the optimization pipeline reaches a fixed final IR.
It should not be mixed into optimization passes.

### Exit State Analysis

Walk final IR and compute:

- pre-instruction snapshots,
- post-instruction snapshots,
- exit points,
- committed registers,
- speculative registers,
- pending flag masks,
- instruction count deltas,
- exit state indexes.

This replaces the current optimization-time tracked state model for lowering
purposes.

### Flag Boundaries

Insert explicit `flags.boundary` ops where lowering needs pending flags
committed before exits or fault points.

This should use final exit state analysis, not stale optimization records.

### Lowering Block

Build the final lowering input:

- instruction metadata,
- final optimized instruction IR,
- inserted boundaries,
- exit points,
- exit states.

Only this layer may introduce lowering-specific decorations.

## Verifier Requirements

Run verification after every pass in test mode and at the end in production.

The verifier should enforce:

- Every local var is defined before use.
- Instruction-local var namespaces remain local unless intentionally changed.
- Condition values are only consumed as conditions.
- Every instruction has a valid terminator/fallthrough shape.
- Faultable memory ops expose side-exit behavior.
- Flag masks contain only known ALU flag bits.
- No unresolved virtual register state remains before lowering.
- Exit state analysis can be computed from final IR.
- Lowering input has all required boundaries and materializations.

The verifier should fail loudly. It should not silently repair IR.

## Migration Strategy

The migration should be done in slices. Each slice should keep the full test
suite green.

### Slice 1: Freeze Behavioral Spec

Keep the existing end-to-end tests. Add missing golden tests before deleting
planner code.

Add golden tests for:

- flag producer deletion after overwrite,
- direct cmp/jcc specialization,
- direct cmp/cmov specialization,
- unsafe flag specialization fallback after register clobber,
- partial flags across `inc` and `dec`,
- incoming CF after `inc`,
- register folding through `mov`, `xor`, `add`,
- register dependency materialization before clobber,
- repeated expensive register reads,
- effective-address folding,
- scaled effective-address fallback,
- pre-instruction memory fault materialization,
- post-instruction exit materialization,
- indirect jump target folding.

Do not assert planner records in new tests. Assert IR output and runtime
behavior.

### Slice 2: Introduce Pass Framework

Add:

- `optimization/pass.ts`,
- new `optimization/pipeline.ts` scaffolding,
- pass stats collection,
- verifier hook points.

Initially the new pipeline can call the old optimizer as one compatibility
pass. The point of this slice is to establish the public shape.

### Slice 3: Move Generic IR Utilities

Move or copy stable helpers into `jit/ir/`:

- walking,
- rewriting,
- value modeling,
- storage binding,
- effect helpers,
- validation.

Do not move planner-specific types. Only move utilities that make sense in a
planner-free world.

### Slice 4: Implement Local DCE As A Real Pass

Replace `passes/dead-local-values.ts` with `passes/local-dce.ts`.

Acceptance criteria:

- Existing local DCE behavior is preserved.
- Memory-faulting reads are not removed incorrectly.
- The pass has direct golden tests.
- The pass can run multiple times safely.

### Slice 5: Implement Flag DCE

Create:

- `analyses/flag-liveness.ts`,
- `passes/flag-dce.ts`.

Acceptance criteria:

- Dead `flags.set` ops are removed.
- Exit-required flags are retained.
- Partial flag writers keep older CF producers live.
- Existing flag materialization deletion tests pass without planner records.

### Slice 6: Implement Reaching Flags

Create:

- `analyses/reaching-flags.ts`.

This should track which flag producer owns each ALU flag bit at every point.
It should support partial writers and materialized/incoming owners.

Acceptance criteria:

- Reads can identify their reaching producer owners.
- Mixed-owner reads are represented explicitly.
- Unsafe direct conditions are rejected.

### Slice 7: Implement Flag Condition Specialization

Create:

- `passes/flag-condition-specialization.ts`.

Acceptance criteria:

- `cmp` plus `jcc` becomes direct condition IR when safe.
- `cmp` plus `cmovcc` becomes direct condition IR when safe.
- `inc` and `dec` result-only conditions specialize only for supported
  condition codes.
- Reads that require incoming or materialized flags remain ordinary
  `aluFlags.condition`.
- The pass does not own flag producer deletion.

### Slice 8: Implement Register Value Analysis

Create:

- `analyses/register-values.ts`,
- `analyses/barriers.ts`.

The analysis should model:

- current symbolic value per register,
- read counts for cost policy,
- dependencies between symbolic values and source registers,
- barriers that require concrete register state.

Acceptance criteria:

- The analysis can explain where each register value must materialize.
- The analysis is recomputed inside the pass and does not escape as a plan.

### Slice 9: Implement Register Value Propagation

Create:

- `passes/register-value-propagation.ts`.

Acceptance criteria:

- Removed `set32` counts match current behavior where useful.
- Materialized `set32` ops appear in normal IR at the barrier point.
- No optimizer `prelude` is created.
- Memory fault exits see correct concrete register state.
- Host trap and branch exits see correct concrete register state.
- Dependency clobbers are materialized before overwrite.

### Slice 10: Move Exit State Analysis Out Of Optimization

Create:

- `lowering-prep/exit-state-analysis.ts`,
- `lowering-prep/lowering-block.ts`.

Acceptance criteria:

- `optimizeJitIrBlock` no longer computes exit state as part of optimization.
- Lowering prep computes equivalent exit states from final IR.
- Runtime JIT tests still pass.

### Slice 11: Move Flag Boundary Insertion To Lowering Prep

Create:

- `lowering-prep/flag-boundaries.ts`.

Acceptance criteria:

- Boundaries are inserted from final exit state analysis.
- The optimizer itself does not insert lowering-only boundaries.
- Existing flag memory access count tests still pass.

### Slice 12: Delete Old Planner And Tracked Optimizer

Remove:

- `optimization/planner/`,
- `optimization/tracked/`,
- old `flags/materialization.ts` wrapper if no longer useful,
- old `passes/register-folding.ts` wrapper if no longer useful,
- stale planner-record tests.

Keep compatibility exports only if external code still imports them. If kept,
mark them as thin wrappers over the new pipeline and avoid exposing planner
concepts.

## Test Migration Plan

### Keep Runtime Tests

The runtime JIT tests are the strongest safety net. Keep them and add more only
where behavior is not covered.

Critical runtime scenarios:

- memory faults preserve pre-instruction state,
- successful stores commit correct state,
- host traps commit post-instruction state,
- branches commit post-instruction state,
- deferred flags materialize correctly,
- partial flags preserve old CF,
- register folding does not change CPU state,
- direct condition specialization does not change branch behavior.

### Replace Planner Tests

Delete tests that assert internal records such as:

- producer records,
- read records,
- materialization records,
- fold records,
- planner stats.

Replace them with:

- pass golden tests,
- verifier tests,
- final optimized IR tests,
- runtime equivalence tests.

### Add Differential Tests

Add randomized or table-driven short blocks for the supported instruction set.
For each generated program:

1. Run the reference interpreter or direct backend.
2. Run the JIT block.
3. Compare registers, flags, EIP, instruction count, memory, and exit reason.

Start with deterministic hand-picked cases. Add random generation later.

## Success Criteria

The migration is complete when:

- Optimization is a sequence of IR-to-IR passes.
- No pass returns a stale side table required by another pass.
- No optimization pass emits `prelude`.
- Exit state analysis lives under lowering prep.
- Flag boundaries are inserted from final IR, not planner records.
- Register and flag optimizations can be understood independently.
- The verifier can catch invalid IR after any pass.
- Runtime JIT tests and pass golden tests cover all current behavior.
- `planner/` and `tracked/` no longer exist under `optimization/`.

## What Not To Preserve

Do not preserve these ideas:

- a single shared register/flag planner,
- reusable plan records keyed by old op indexes,
- optimizer-generated preludes,
- planner stats as part of the public story,
- direct exposure of materialization records,
- domain adapters that exist only to make unrelated optimizations look uniform.

Preserve these instead:

- current runtime behavior,
- flag correctness,
- fault snapshot correctness,
- register folding wins,
- direct condition specialization wins,
- the useful tests, rewritten around observable pass output.

