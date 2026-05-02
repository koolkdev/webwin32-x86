import type { Reg32 } from "../isa/types.js";

export type VarId = number;

export type VarRef = Readonly<{ kind: "var"; id: VarId }>;
export type Const32Ref = Readonly<{ kind: "const32"; value: number }>;
export type NextEipRef = Readonly<{ kind: "nextEip" }>;
export type ValueRef = VarRef | Const32Ref | NextEipRef;

export type OperandRef = Readonly<{ kind: "operand"; index: number }>;
export type RegRef = Readonly<{ kind: "reg"; reg: Reg32 }>;
export type MemRef = Readonly<{ kind: "mem"; address: ValueRef }>;
export type StorageRef = OperandRef | RegRef | MemRef;

export type TargetRef = ValueRef;

export type ConditionCode =
  | "O"
  | "NO"
  | "B"
  | "AE"
  | "E"
  | "NE"
  | "BE"
  | "A"
  | "S"
  | "NS"
  | "P"
  | "NP"
  | "L"
  | "GE"
  | "LE"
  | "G";

export type FlagProducerName = "add32" | "sub32" | "logic32" | "inc32" | "dec32";
export type FlagMask = number;

export type SirOp =
  | Readonly<{ op: "get32"; dst: VarRef; source: StorageRef }>
  | Readonly<{ op: "set32"; target: StorageRef; value: ValueRef }>
  | Readonly<{ op: "address32"; dst: VarRef; operand: OperandRef }>
  | Readonly<{ op: "const32"; dst: VarRef; value: number }>
  | Readonly<{ op: "i32.add"; dst: VarRef; a: ValueRef; b: ValueRef }>
  | Readonly<{ op: "i32.sub"; dst: VarRef; a: ValueRef; b: ValueRef }>
  | Readonly<{ op: "i32.xor"; dst: VarRef; a: ValueRef; b: ValueRef }>
  | Readonly<{ op: "i32.and"; dst: VarRef; a: ValueRef; b: ValueRef }>
  | Readonly<{
      op: "flags.set";
      producer: FlagProducerName;
      inputs: Readonly<Record<string, ValueRef>>;
    }>
  | Readonly<{ op: "flags.materialize"; mask: FlagMask }>
  | Readonly<{ op: "flags.boundary"; mask: FlagMask }>
  | Readonly<{ op: "condition"; dst: VarRef; cc: ConditionCode }>
  | Readonly<{ op: "next" }>
  | Readonly<{ op: "jump"; target: TargetRef }>
  | Readonly<{ op: "conditionalJump"; condition: ValueRef; taken: TargetRef; notTaken: TargetRef }>
  | Readonly<{ op: "hostTrap"; vector: ValueRef }>;

export type SirProgram = readonly SirOp[];
export type SemanticTemplate = (builder: SirBuilder) => void;

export interface SirBuilder {
  operand(index: number): OperandRef;
  const32(value: number): Const32Ref;
  nextEip(): NextEipRef;
  reg32(reg: Reg32): RegRef;
  mem32(address: ValueInput): MemRef;

  get32(source: StorageInput): VarRef;
  set32(target: StorageInput, value: ValueInput): void;
  address32(operand: OperandInput): VarRef;

  setConst32(value: number): VarRef;
  i32Add(a: ValueInput, b: ValueInput): VarRef;
  i32Sub(a: ValueInput, b: ValueInput): VarRef;
  i32Xor(a: ValueInput, b: ValueInput): VarRef;
  i32And(a: ValueInput, b: ValueInput): VarRef;

  setFlags(producer: FlagProducerName, inputs: Readonly<Record<string, ValueInput>>): void;
  materializeFlags(mask: FlagMask): void;
  boundaryFlags(mask: FlagMask): void;
  condition(cc: ConditionCode): VarRef;

  next(): void;
  jump(target: TargetInput): void;
  conditionalJump(condition: ValueInput, taken: TargetInput, notTaken: TargetInput): void;
  hostTrap(vector: ValueInput): void;
}

export type OperandInput = OperandRef;
export type StorageInput = StorageRef;
export type ValueInput = ValueRef | number;
export type TargetInput = ValueInput;
