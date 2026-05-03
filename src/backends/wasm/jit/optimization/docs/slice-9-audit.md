# Slice 9 Architecture Audit

This audit captures the current optimizer shape after Slice 8. It is not a
target architecture; it names the code that must move so flags and registers
can fold through one shared planner model.

## Classification

| Area | Files | Current role | Slice 10+ direction |
| --- | --- | --- | --- |
| Shared planner model | `planner/plan.ts`, `planner/stats.ts` | Shared record and stats types. | Keep shared. Extend with adapter-facing records only when needed. |
| Shared planner walk | `planner/planner.ts` | Mixed shared walk plus register and flag discovery logic. | Strip back to orchestration over normalized facts. |
| Shared policy | `planner/policy.ts` | Cross-domain facade plus some register cost helpers. | Keep cross-domain decisions here; move domain-only policy to adapters. |
| Emitter-only code | `planner/emitter.ts`, `ir/rewrite.ts` | Emits legacy flag and register transformations and rewrite helpers. | Replace independent planning bodies with one plan-driven emitter plus small domain emit hooks. |
| Register domain adapter candidates | `registers/values.ts`, `registers/policy.ts`, `registers/materialization.ts`, `registers/rewrite.ts`, `registers/folding-prefix.ts` | Register values, cost policy, materialization, and rewrite behavior. | Add a register planner adapter that reports normalized facts; keep rewrite details in register emit hooks. |
| Flag domain adapter candidates | `flags/analysis.ts`, `flags/sources.ts`, `flags/owners.ts`, `flags/conditions.ts`, `flags/policy.ts`, `flags/materialization.ts` | Flag source ownership, direct condition analysis, and materialization wrapper. | Add a flag planner adapter that reports normalized facts; keep direct-condition IR details in flag emit hooks. |
| Shared tracking | `tracked/state.ts`, `tracked/optimization-state.ts`, `tracked/analysis.ts`, `tracked/context.ts`, `tracked/types.ts`, `tracked/block-state-tracker.ts`, `tracked/state-analysis.ts` | Tracks values, producers, reads, exits, and snapshots. | Keep shared; avoid adding domain optimizer policy here. |
| Shared IR/effects helpers | `effects/*`, `ir/*` | Effect indexes, value modeling, ranges, operand binding, and IR rewrite primitives. | Keep shared infrastructure. |
| Compatibility wrappers | `passes/register-folding.ts`, `flags/materialization.ts`, `pipeline.ts`, `optimize.ts` | Public entry points and pass result shape. | Keep wrappers thin; final pipeline should call only shared planner/emitter. |
| Tests | `tests/*` | Behavior and record coverage. | Keep; add hard shared-path expected-output coverage after adapter split. |

## Legacy Duplicate Implementations

`planner/emitter.ts` still contains two independent optimizer bodies:

- `planJitFlagMaterialization` performs flag planning and rewrites IR in the
  same pass.
- `planJitRegisterFolding` performs register planning and rewrites IR in the
  same pass.

Those functions are useful as the short-term legacy comparison oracle for the
plan-driven emitter, but they are duplicate optimizer implementations. Slice 15
should delete them or collapse them into wrappers over the shared planner and
emitter.

## Domain Leakage In `planner.ts`

`planner/planner.ts` currently records shared plan records, but it does so with
domain-specific branches and helpers. These are the concrete move targets.

### Flag-Specific Logic To Move

- Imports flag analysis, direct condition indexes, source types, and flag policy
  directly (`planner.ts:19` through `planner.ts:29`).
- Builds flag-only side indexes before the shared walk:
  `analyzeJitFlags`, `indexDirectFlagConditions`, needed source IDs, and source
  lookup maps (`planner.ts:108` through `planner.ts:111`).
- Tracks instruction-entry flag owners for pre-instruction snapshots inside the
  shared walk (`planner.ts:133`).
- Handles pre/post-exit flag reads directly, including masks and exit reasons
  (`planner.ts:152` through `planner.ts:181`).
- Handles `flags.set`, source lookup, producer records, unused-source drops, and
  retained-source materialization records (`planner.ts:228` through
  `planner.ts:260`).
- Handles `aluFlags.condition`, condition-use detection, direct-condition
  lookup, condition reads, and `flagCondition` fold records (`planner.ts:263`
  through `planner.ts:292`).
- Handles `flags.materialize` and `flags.boundary` reads and materialized owner
  updates (`planner.ts:295` through `planner.ts:319`).
- Defines flag-specific helper functions for read recording, phase mapping,
  needed source IDs, materialization tests, source indexing, and source lookup
  (`planner.ts:349` through `planner.ts:402`, `planner.ts:784` through
  `planner.ts:861`).

These belong in a flag planner adapter. The shared planner should receive facts
such as producer, read, clobber, fold candidate, drop candidate, and boundary
materialization without knowing about flag masks, source IDs, or direct
condition indexes.

### Register-Specific Logic To Move

- Imports register policy and register value helpers directly (`planner.ts:47`
  through `planner.ts:58`).
- Records pre/post-exit register materialization locations inside the shared
  walk (`planner.ts:134` through `planner.ts:141`, `planner.ts:182` through
  `planner.ts:189`).
- Handles `get32` and `address32` read/fallback/repeated-read materialization
  decisions directly (`planner.ts:193` through `planner.ts:207`).
- Handles `set32` and `set32.if` register clobbers, dependency materialization,
  retained producer records, fold records, and drop records directly
  (`planner.ts:217` through `planner.ts:226`).
- Defines register-specific helpers for `get32`, `address32`, dependency
  clobbers, conditional writeback reads, write clobber records, retained
  producer policy, read counting, and materialization counting
  (`planner.ts:405` through `planner.ts:782`).

These belong in a register planner adapter. The shared planner should not know
about `get32`, `address32`, `set32`, `set32.if`, read counters, effective
address fallback, or concrete `Reg32` extraction.

### Cross-Domain Logic To Keep Shared

- Register writes invalidating flag producer inputs are genuinely cross-domain
  and should remain coordinated by shared policy. The current call sites are
  mixed into `set32` and `set32.if` handling (`planner.ts:217`,
  `planner.ts:224`) and the helper at `planner.ts:542`.
- The future shape should make this a shared decision over normalized clobber
  facts: the register adapter reports a write, the flag adapter/policy reports
  affected flag producers, and the shared planner records the dependency
  clobber.

## Required Refactor Direction

1. Define a domain adapter contract that reports normalized facts without
   register/flag naming in the shared type surface.
2. Move register op discovery and register materialization location discovery
   out of `planner/planner.ts`.
3. Move flag source/read/direct-condition discovery out of `planner/planner.ts`.
4. Make shared planner code apply decisions over normalized producer/read/
   clobber/materialization/fold/drop facts.
5. Make the emitter consume shared decisions and delegate only IR-specific
   details to register and flag emit hooks.

Until that happens, `planner/planner.ts` is a centralized mixed-domain planner,
not a real shared folding planner.
