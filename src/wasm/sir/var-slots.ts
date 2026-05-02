import type {
  SirExprOp,
  SirExprProgram,
  SirStorageExpr,
  SirValueExpr
} from "../../arch/x86/sir/expressions.js";

export type SirExprVarSlotAssignment = Readonly<{
  slotCount: number;
  slotByVar: ReadonlyMap<number, number>;
}>;

type MutableVarLifetime = {
  id: number;
  start: number;
  end: number;
};

type ActiveSlot = Readonly<{
  end: number;
  slot: number;
}>;

export function assignSirExprVarSlots(program: SirExprProgram): SirExprVarSlotAssignment {
  const lifetimes = collectVarLifetimes(program);
  const slotByVar = new Map<number, number>();
  const freeSlots: number[] = [];
  let activeSlots: ActiveSlot[] = [];
  let slotCount = 0;

  for (const lifetime of lifetimes) {
    const stillActive: ActiveSlot[] = [];

    for (const active of activeSlots) {
      if (active.end < lifetime.start) {
        freeSlots.push(active.slot);
      } else {
        stillActive.push(active);
      }
    }

    activeSlots = stillActive;
    freeSlots.sort((a, b) => a - b);

    const reusableSlot = freeSlots.shift();
    const slot = reusableSlot ?? slotCount;

    if (reusableSlot === undefined) {
      slotCount += 1;
    }

    slotByVar.set(lifetime.id, slot);
    activeSlots.push({ end: lifetime.end, slot });
  }

  return { slotCount, slotByVar };
}

function collectVarLifetimes(program: SirExprProgram): MutableVarLifetime[] {
  const lifetimes = new Map<number, MutableVarLifetime>();

  program.forEach((op, opIndex) => {
    const usePosition = opIndex * 2;

    collectOpVarUses(op, (id) => {
      const lifetime = lifetimes.get(id);

      if (lifetime === undefined) {
        throw new Error(`SIR var ${id} is used before slot assignment definition`);
      }

      lifetime.end = Math.max(lifetime.end, usePosition);
    });

    if (op.op === "let32") {
      const start = usePosition + 1;

      if (lifetimes.has(op.dst.id)) {
        throw new Error(`SIR var ${op.dst.id} is assigned more than once during slot assignment`);
      }

      lifetimes.set(op.dst.id, { id: op.dst.id, start, end: start });
    }
  });

  return Array.from(lifetimes.values()).sort((a, b) => a.start - b.start);
}

function collectOpVarUses(op: SirExprOp, visit: (id: number) => void): void {
  switch (op.op) {
    case "let32":
      collectValueVarUses(op.value, visit);
      return;
    case "set32":
      collectStorageVarUses(op.target, visit);
      collectValueVarUses(op.value, visit);
      return;
    case "flags.set":
      for (const value of Object.values(op.inputs)) {
        collectValueVarUses(value, visit);
      }
      return;
    case "flags.materialize":
    case "flags.boundary":
      return;
    case "next":
      return;
    case "jump":
      collectValueVarUses(op.target, visit);
      return;
    case "conditionalJump":
      collectValueVarUses(op.condition, visit);
      collectValueVarUses(op.taken, visit);
      collectValueVarUses(op.notTaken, visit);
      return;
    case "hostTrap":
      collectValueVarUses(op.vector, visit);
      return;
  }
}

function collectStorageVarUses(storage: SirStorageExpr, visit: (id: number) => void): void {
  if (storage.kind === "mem") {
    collectValueVarUses(storage.address, visit);
  }
}

function collectValueVarUses(value: SirValueExpr, visit: (id: number) => void): void {
  switch (value.kind) {
    case "var":
      visit(value.id);
      return;
    case "const32":
    case "nextEip":
    case "address32":
    case "condition":
      return;
    case "src32":
      collectStorageVarUses(value.source, visit);
      return;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.and":
      collectValueVarUses(value.a, visit);
      collectValueVarUses(value.b, visit);
      return;
  }
}
