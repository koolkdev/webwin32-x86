export type DecodeFaultReason = "truncated" | "instructionTooLong";

export type DecodeFault = Readonly<{
  reason: DecodeFaultReason;
  address: number;
  offset: number;
  raw: readonly number[];
}>;

export class DecodeError extends Error {
  readonly fault: DecodeFault;

  constructor(fault: DecodeFault) {
    super(`${fault.reason} decode at 0x${fault.address.toString(16)} offset ${fault.offset}`);
    this.name = "DecodeError";
    this.fault = fault;
  }
}
