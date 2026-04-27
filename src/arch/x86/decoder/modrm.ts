import { reg32, type Reg32 } from "../instruction/types.js";

export type RegisterModRm = Readonly<{
  reg: Reg32;
  rm: Reg32;
}>;

export function decodeRegisterModRm(value: number): RegisterModRm | undefined {
  const mod = value >>> 6;

  if (mod !== 3) {
    return undefined;
  }

  return {
    reg: register(value >>> 3),
    rm: register(value)
  };
}

function register(value: number): Reg32 {
  const reg = reg32[value & 0b111];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for ModRM byte 0x${value.toString(16)}`);
  }

  return reg;
}
