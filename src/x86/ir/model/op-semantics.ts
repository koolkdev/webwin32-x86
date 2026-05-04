import type {
  IrBinaryValueOp,
  IrOp,
  StorageRef,
  ValueRef,
  VarRef
} from "./types.js";

export type IrValueUseRole = "condition" | "value";
export type IrStorageUseRole = "read" | "write";
export type IrResultSideEffect = "none" | "storageRead";

export type IrValueUse = Readonly<{
  value: ValueRef;
  role: IrValueUseRole;
}>;

export type IrStorageUse = Readonly<{
  storage: StorageRef;
  role: IrStorageUseRole;
}>;

export type IrOpResult =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "value"; dst: VarRef; sideEffect: IrResultSideEffect }>;

export type IrTerminatorOp = Extract<IrOp, { op: "next" | "jump" | "conditionalJump" | "hostTrap" }>;

export function irOpIsBinaryValue<T extends { op: string }>(op: T): op is Extract<T, IrBinaryValueOp> {
  switch (op.op) {
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      return true;
    default:
      return false;
  }
}

export function irOpResult(op: IrOp): IrOpResult {
  switch (op.op) {
    case "get32":
      return { kind: "value", dst: op.dst, sideEffect: "storageRead" };
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "aluFlags.condition":
      return { kind: "value", dst: op.dst, sideEffect: "none" };
    case "set32":
    case "set32.if":
    case "flags.set":
    case "flags.materialize":
    case "flags.boundary":
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap":
      return { kind: "none" };
  }

  return assertNever(op);
}

export function irOpDst(op: IrOp): VarRef | undefined {
  const result = irOpResult(op);

  return result.kind === "value" ? result.dst : undefined;
}

export function irOpIsTerminator(op: IrOp): op is IrTerminatorOp {
  switch (op.op) {
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap":
      return true;
    case "get32":
    case "set32":
    case "set32.if":
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "flags.set":
    case "flags.materialize":
    case "flags.boundary":
    case "aluFlags.condition":
      return false;
  }

  return assertNever(op);
}

export function irOpValueUses(op: IrOp): readonly IrValueUse[] {
  const uses: IrValueUse[] = [];

  visitIrOpValueRefs(op, (value, role) => {
    uses.push({ value, role });
  });
  return uses;
}

export function visitIrOpValueRefs(
  op: IrOp,
  visit: (value: ValueRef, role: IrValueUseRole) => void
): void {
  switch (op.op) {
    case "get32":
      visitIrStorageValueRefs(op.source, visit);
      return;
    case "set32":
      visitIrStorageValueRefs(op.target, visit);
      visit(op.value, "value");
      return;
    case "set32.if":
      visit(op.condition, "condition");
      visitIrStorageValueRefs(op.target, visit);
      visit(op.value, "value");
      return;
    case "address32":
    case "const32":
      return;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      visit(op.a, "value");
      visit(op.b, "value");
      return;
    case "flags.set":
      for (const value of Object.values(op.inputs)) {
        visit(value, "value");
      }
      return;
    case "flags.materialize":
    case "flags.boundary":
    case "aluFlags.condition":
    case "next":
      return;
    case "jump":
      visit(op.target, "value");
      return;
    case "conditionalJump":
      visit(op.condition, "condition");
      visit(op.taken, "value");
      visit(op.notTaken, "value");
      return;
    case "hostTrap":
      visit(op.vector, "value");
      return;
  }

  assertNever(op);
}

export function irOpStorageUses(op: IrOp): readonly IrStorageUse[] {
  const uses: IrStorageUse[] = [];

  visitIrOpStorageRefs(op, (storage, role) => {
    uses.push({ storage, role });
  });
  return uses;
}

export function irOpStorageReads(op: IrOp): readonly StorageRef[] {
  return irOpStorageUses(op)
    .filter((use) => use.role === "read")
    .map((use) => use.storage);
}

export function irOpStorageWrites(op: IrOp): readonly StorageRef[] {
  return irOpStorageUses(op)
    .filter((use) => use.role === "write")
    .map((use) => use.storage);
}

export function visitIrOpStorageRefs(
  op: IrOp,
  visit: (storage: StorageRef, role: IrStorageUseRole) => void
): void {
  switch (op.op) {
    case "get32":
      visit(op.source, "read");
      return;
    case "set32":
    case "set32.if":
      visit(op.target, "write");
      return;
    case "address32":
    case "const32":
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
    case "flags.set":
    case "flags.materialize":
    case "flags.boundary":
    case "aluFlags.condition":
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap":
      return;
  }

  assertNever(op);
}

export function visitIrStorageValueRefs(
  storage: StorageRef,
  visit: (value: ValueRef, role: IrValueUseRole) => void
): void {
  if (storage.kind === "mem") {
    visit(storage.address, "value");
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled IR op semantics: ${JSON.stringify(value)}`);
}
