# Architecture Ownership

This project targets 32-bit x86. The source tree is organized around three ownership layers:

- `x86/` describes x86 state, memory, decoding, instruction semantics, and the shared IR.
- `backends/` execute or lower x86 IR through a concrete implementation strategy.
- `runtime/` orchestrates programs, engine selection, budgets, caches, and the public runtime API.

## Dependency Direction

Production code must follow this direction:

```text
x86/       -> no runtime or backend imports
backends/  -> may import x86, must not import runtime
runtime/   -> may import x86 and backend public APIs
```

Tests and test-support files may cross these boundaries when they are testing integration behavior.

## Layer Contracts

### x86

The `x86/` layer owns architectural meaning:

- CPU state shape, flags, registers, memory access contracts, and run-result types.
- ISA decode tables, schemas, operand decoding, and formatting.
- Instruction semantics expressed by emitting x86 IR.
- IR model, builders, validation, analysis, and optimization passes.

It must not know whether execution happens directly, through Wasm, or through a future backend.

### backends

The `backends/` layer owns execution mechanisms:

- Lowering x86 IR to backend-specific code.
- Interpreting x86 IR directly, if a direct backend exists.
- Backend state caches, host bindings, memory adapters, artifacts, probes, and compiled-block machinery.

Backends should consume x86 IR instead of reimplementing ISA semantics. A direct backend should be an IR interpreter, not a second ISA interpreter.

### runtime

The `runtime/` layer owns orchestration:

- Public runtime instance construction.
- Program region loading and code maps.
- Instruction budgets, modes, engine contracts, and engine selection.
- Runtime-level cache policy and engine lifecycle.

Runtime should not own backend internals such as Wasm memory layout, Wasm module construction, or JIT block handles.

## Naming Rules

- `runtime` means orchestration, not an execution backend.
- `isa` means x86 decode/spec/semantics.
- `ir` means the shared x86 intermediate representation emitted by ISA semantics.
- `lowering` means converting IR into backend operations.
- `interpreter` means a backend execution mode that runs code without dynamic block compilation.
- `jit` means a backend execution mode that dynamically compiles and caches blocks.

Avoid reusing these names for different layers.
