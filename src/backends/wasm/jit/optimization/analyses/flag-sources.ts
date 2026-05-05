import { reg32, type Reg32 } from "#x86/isa/types.js";
import { FLAG_PRODUCERS } from "#x86/ir/model/flags.js";
import type { IrFlagSetOp, ValueRef } from "#x86/ir/model/types.js";
import type { JitValue } from "#backends/wasm/jit/ir/values.js";
import { jitValueMaterializationRegs } from "#backends/wasm/jit/ir/values.js";
import type { JitValueTracker } from "#backends/wasm/jit/ir/value-tracker.js";

export type JitFlagInput =
  | Readonly<{ kind: "value"; value: JitValue }>
  | Readonly<{ kind: "reg"; reg: Reg32 }>
  | Readonly<{ kind: "unmodeled" }>;

export type JitFlagSource = Readonly<{
  id: number;
  instructionIndex: number;
  opIndex: number;
  producer: IrFlagSetOp["producer"];
  width?: IrFlagSetOp["width"];
  writtenMask: number;
  undefMask: number;
  inputs: Readonly<Record<string, JitFlagInput>>;
  readRegs: readonly Reg32[];
}>;

export function buildJitFlagSource(
  id: number,
  instructionIndex: number,
  opIndex: number,
  op: IrFlagSetOp,
  values: JitValueTracker
): JitFlagSource {
  const inputs = flagInputs(op, values);

  return {
    id,
    instructionIndex,
    opIndex,
    producer: op.producer,
    ...(op.width === undefined ? {} : { width: op.width }),
    writtenMask: op.writtenMask,
    undefMask: op.undefMask,
    inputs,
    readRegs: flagInputReadRegs(inputs)
  };
}

function flagInputs(
  op: IrFlagSetOp,
  values: JitValueTracker
): Readonly<Record<string, JitFlagInput>> {
  return Object.fromEntries(
    FLAG_PRODUCERS[op.producer].inputs.map((inputName) => [
      inputName,
      flagInput(op.inputs[inputName], values)
    ])
  );
}

function flagInput(
  value: ValueRef | undefined,
  values: JitValueTracker
): JitFlagInput {
  if (value === undefined) {
    return { kind: "unmodeled" };
  }

  const jitValue = values.valueFor(value);

  return jitValue === undefined
    ? { kind: "unmodeled" }
    : { kind: "value", value: jitValue };
}

function flagInputReadRegs(inputs: Readonly<Record<string, JitFlagInput>>): readonly Reg32[] {
  const regs = new Set<Reg32>();

  for (const input of Object.values(inputs)) {
    if (input.kind === "value") {
      for (const reg of jitValueMaterializationRegs(input.value)) {
        regs.add(reg);
      }
    } else if (input.kind === "reg") {
      regs.add(input.reg);
    }
  }

  return reg32.filter((reg) => regs.has(reg));
}
