import { doesNotThrow, throws } from "node:assert";
import { test } from "node:test";

import { aluSemantic } from "../../isa/semantics/alu.js";
import { jccSemantic } from "../../isa/semantics/control.js";
import { cmpSemantic } from "../../isa/semantics/cmp.js";
import { leaSemantic } from "../../isa/semantics/lea.js";
import { intSemantic } from "../../isa/semantics/misc.js";
import { movSemantic } from "../../isa/semantics/mov.js";
import { buildSir, const32, operand, sirVar } from "../builder.js";
import { createSirFlagProducerConditionOp, createSirFlagSetOp } from "../flags.js";
import { validateSirProgram } from "../validator.js";

test("validator accepts representative generated semantic templates", () => {
  doesNotThrow(() => validateSirProgram(buildSir(movSemantic()), { operandCount: 2 }));
  doesNotThrow(() => validateSirProgram(buildSir(leaSemantic()), { operandCount: 2 }));
  doesNotThrow(() => validateSirProgram(buildSir(aluSemantic("add", 32)), { operandCount: 2 }));
  doesNotThrow(() => validateSirProgram(buildSir(cmpSemantic()), { operandCount: 2 }));
  doesNotThrow(() => validateSirProgram(buildSir(jccSemantic("NE")), { operandCount: 1 }));
  doesNotThrow(() => validateSirProgram(buildSir(intSemantic()), { operandCount: 1 }));
});

test("validator rejects missing terminator and ops after terminator", () => {
  throws(() => validateSirProgram([{ op: "get32", dst: sirVar(0), source: operand(0) }]), /exactly one terminator/);

  throws(
    () =>
      validateSirProgram([
        { op: "next" },
        { op: "jump", target: const32(0) }
      ]),
    /after terminator/
  );
});

test("validator rejects duplicate vars, use before definition, and missing operands", () => {
  throws(
    () =>
      validateSirProgram([
        { op: "get32", dst: sirVar(0), source: operand(0) },
        { op: "i32.add", dst: sirVar(0), a: sirVar(0), b: const32(1) },
        { op: "next" }
      ]),
    /assigned more than once/
  );

  throws(
    () =>
      validateSirProgram([
        { op: "i32.add", dst: sirVar(0), a: sirVar(1), b: const32(1) },
        { op: "next" }
      ]),
    /used before definition/
  );

  throws(
    () => validateSirProgram([{ op: "get32", dst: sirVar(0), source: operand(1) }, { op: "next" }], { operandCount: 1 }),
    /operand 1 does not exist/
  );
});

test("validator rejects invalid aluFlags operation masks", () => {
  throws(
    () => validateSirProgram([{ op: "flags.materialize", mask: 0 }, { op: "next" }]),
    /flags\.materialize requires a nonzero aluFlags mask/
  );

  throws(
    () => validateSirProgram([{ op: "flags.boundary", mask: 1 << 6 }, { op: "next" }]),
    /flags\.boundary mask must contain only SIR aluFlags bits/
  );
});

test("validator rejects malformed flag producer inputs", () => {
  throws(
    () =>
      validateSirProgram([
        { op: "const32", dst: sirVar(0), value: 1 },
        createSirFlagSetOp("logic32", {}),
        { op: "next" }
      ]),
    /flags\.set logic32 is missing input 'result'/
  );

  throws(
    () =>
      validateSirProgram([
        { op: "const32", dst: sirVar(0), value: 1 },
        createSirFlagSetOp("logic32", { result: sirVar(0), extra: sirVar(0) }),
        { op: "next" }
      ]),
    /flags\.set logic32 has unexpected input 'extra'/
  );
});

test("validator rejects flag descriptors that disagree with producer metadata", () => {
  throws(
    () =>
      validateSirProgram([
        { op: "const32", dst: sirVar(0), value: 1 },
        { ...createSirFlagSetOp("logic32", { result: sirVar(0) }), writtenMask: 1 },
        { op: "next" }
      ]),
    /flags\.set logic32 writtenMask does not match producer metadata/
  );

  throws(
    () =>
      validateSirProgram([
        { op: "const32", dst: sirVar(0), value: 1 },
        { ...createSirFlagSetOp("add32", { left: sirVar(0), right: const32(1), result: sirVar(0) }), undefMask: 1 },
        { op: "next" }
      ]),
    /flags\.set add32 undefMask does not match producer metadata/
  );
});

test("validator rejects unsupported flag producer conditions", () => {
  const descriptor = createSirFlagSetOp("logic32", { result: sirVar(0) });

  throws(
    () =>
      validateSirProgram([
        { op: "const32", dst: sirVar(0), value: 1 },
        createSirFlagProducerConditionOp(sirVar(1), "E", descriptor),
        { op: "next" }
      ]),
    /flagProducer\.condition logic32\/E is not supported/
  );
});
