import type { IrOp } from "./types.js";

export type IrTerminatorOp = Extract<IrOp, { op: "next" | "jump" | "conditionalJump" | "hostTrap" }>;

export function isIrTerminatorOp(op: IrOp): op is IrTerminatorOp {
  return op.op === "next" || op.op === "jump" || op.op === "conditionalJump" || op.op === "hostTrap";
}
