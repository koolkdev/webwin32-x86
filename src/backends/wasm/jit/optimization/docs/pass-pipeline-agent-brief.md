# Agent Brief: JIT Optimizer Pass Pipeline Redesign

Full plan: [`pass-pipeline-redesign.md`](./pass-pipeline-redesign.md)

## Goal

Replace the current `optimization/planner/` and `optimization/tracked/` architecture with a conventional optimizer made of small IR-to-IR passes. Preserve the current JIT behavior and test coverage, but do not preserve the shared planner model, planner records, optimizer-generated preludes, or stale op-index side tables.

The target shape is:

```txt
jit/ir/              shared JIT IR utilities and validation
jit/optimization/    pure optimization passes and analyses
jit/lowering-plan/   exit state analysis and lowering-only decorations
jit/lowering/        Wasm emission
```

## Main Slices

1. Freeze the behavioral spec: keep runtime tests, add golden IR tests for flags, register folding, memory faults, partial flags, and direct conditions.
2. Introduce a small pass framework: `JitOptimizationPass`, `JitPassResult`, stats collection, and verifier hooks.
3. Move generic IR utilities into `jit/ir/`: walking, rewriting, values, effects, storage helpers, and validation.
4. Implement `local-dce` as a real pass.
5. Implement `flag-dce` using bit-level flag liveness.
6. Implement reaching flag producer analysis.
7. Implement `flag-condition-specialization` for safe direct `jcc`/`cmovcc` conditions.
8. Implement register value and barrier analyses.
9. Implement `register-value-propagation`, inserting real `set32` materialization at barriers in normal IR.
10. Move exit state analysis out of optimization into `lowering-plan/`.
11. Move flag boundary insertion into `lowering-plan/`.
12. Delete the old planner/tracked optimizer and replace planner-record tests with pass-output and runtime-equivalence tests.

## Non-Negotiables

- Every optimization pass takes IR and returns IR.
- Analyses are recomputed as needed and do not escape as required side tables.
- `prelude` is not optimizer output; it is a lowering concern if still needed.
- Exit snapshots are computed from final IR.
- Verifiers run after passes in tests and at the end in production.
- Register optimization and flag optimization should be understandable independently.

