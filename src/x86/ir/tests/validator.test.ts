import { doesNotThrow, throws } from "node:assert";
import { test } from "node:test";

import { aluSemantic } from "#x86/isa/semantics/alu.js";
import { jccSemantic } from "#x86/isa/semantics/control.js";
import { cmpSemantic } from "#x86/isa/semantics/cmp.js";
import { leaSemantic } from "#x86/isa/semantics/lea.js";
import { intSemantic } from "#x86/isa/semantics/misc.js";
import { movSemantic } from "#x86/isa/semantics/mov.js";
import { buildIr, const32, operand, irVar } from "#x86/ir/build/builder.js";
import { createIrFlagProducerConditionOp, createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { validateIrBlock } from "#x86/ir/passes/validator.js";

test("validator accepts representative generated semantic templates", () => {
  doesNotThrow(() => validateIrBlock(buildIr(movSemantic()), { operandCount: 2 }));
  doesNotThrow(() => validateIrBlock(buildIr(leaSemantic()), { operandCount: 2 }));
  doesNotThrow(() => validateIrBlock(buildIr(aluSemantic("add", 32)), { operandCount: 2 }));
  doesNotThrow(() => validateIrBlock(buildIr(cmpSemantic()), { operandCount: 2 }));
  doesNotThrow(() => validateIrBlock(buildIr(jccSemantic("NE")), { operandCount: 1 }));
  doesNotThrow(() => validateIrBlock(buildIr(intSemantic()), { operandCount: 1 }));
});

test("validator rejects missing terminator and ops after terminator", () => {
  throws(() => validateIrBlock([{ op: "get32", dst: irVar(0), source: operand(0) }]), /exactly one terminator/);

  throws(
    () =>
      validateIrBlock([
        { op: "next" },
        { op: "jump", target: const32(0) }
      ]),
    /after terminator/
  );
});

test("validator rejects duplicate vars, use before definition, and missing operands", () => {
  throws(
    () =>
      validateIrBlock([
        { op: "get32", dst: irVar(0), source: operand(0) },
        { op: "i32.add", dst: irVar(0), a: irVar(0), b: const32(1) },
        { op: "next" }
      ]),
    /assigned more than once/
  );

  throws(
    () =>
      validateIrBlock([
        { op: "i32.add", dst: irVar(0), a: irVar(1), b: const32(1) },
        { op: "next" }
      ]),
    /used before definition/
  );

  throws(
    () => validateIrBlock([{ op: "get32", dst: irVar(0), source: operand(1) }, { op: "next" }], { operandCount: 1 }),
    /operand 1 does not exist/
  );
});

test("validator rejects invalid aluFlags operation masks", () => {
  throws(
    () => validateIrBlock([{ op: "flags.materialize", mask: 0 }, { op: "next" }]),
    /flags\.materialize requires a nonzero aluFlags mask/
  );

  throws(
    () => validateIrBlock([{ op: "flags.boundary", mask: 1 << 6 }, { op: "next" }]),
    /flags\.boundary mask must contain only IR aluFlags bits/
  );
});

test("validator rejects malformed flag producer inputs", () => {
  throws(
    () =>
      validateIrBlock([
        { op: "const32", dst: irVar(0), value: 1 },
        createIrFlagSetOp("logic32", {}),
        { op: "next" }
      ]),
    /flags\.set logic32 is missing input 'result'/
  );

  throws(
    () =>
      validateIrBlock([
        { op: "const32", dst: irVar(0), value: 1 },
        createIrFlagSetOp("logic32", { result: irVar(0), extra: irVar(0) }),
        { op: "next" }
      ]),
    /flags\.set logic32 has unexpected input 'extra'/
  );
});

test("validator rejects flag descriptors that disagree with producer metadata", () => {
  throws(
    () =>
      validateIrBlock([
        { op: "const32", dst: irVar(0), value: 1 },
        { ...createIrFlagSetOp("logic32", { result: irVar(0) }), writtenMask: 1 },
        { op: "next" }
      ]),
    /flags\.set logic32 writtenMask does not match producer metadata/
  );

  throws(
    () =>
      validateIrBlock([
        { op: "const32", dst: irVar(0), value: 1 },
        { ...createIrFlagSetOp("add32", { left: irVar(0), right: const32(1), result: irVar(0) }), undefMask: 1 },
        { op: "next" }
      ]),
    /flags\.set add32 undefMask does not match producer metadata/
  );
});

test("validator rejects unsupported flag producer conditions", () => {
  const descriptor = createIrFlagSetOp("logic32", { result: irVar(0) });

  throws(
    () =>
      validateIrBlock([
        { op: "const32", dst: irVar(0), value: 1 },
        createIrFlagProducerConditionOp(irVar(1), "E", descriptor),
        { op: "next" }
      ]),
    /flagProducer\.condition logic32\/E is not supported/
  );
});
