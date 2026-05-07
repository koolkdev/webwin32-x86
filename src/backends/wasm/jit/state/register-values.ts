import { type OperandWidth, type RegisterAlias, type Reg32 } from "#x86/isa/types.js";

export type Owner = Readonly<{
  retain(): Owner;
  release(): void;
}>;

export type UnknownRegValueState = {
  kind: "unknown";
};

export type LocalRegValueState = {
  kind: "local";
  local: number;
  width: OperandWidth;
  owner?: Owner | undefined;
};

export type RegValueState = UnknownRegValueState | LocalRegValueState;

export type LocalRegValueSource = Readonly<LocalRegValueState>;

export const fullWidth = 32;
export const byteWidth = 8;

const fullAliasOffset = 0;

export function emptyRegValueState(): RegValueState {
  return { kind: "unknown" };
}

export function cloneRegValueState(state: RegValueState): RegValueState {
  return state.kind === "unknown"
    ? emptyRegValueState()
    : localRegValueSource(state.local, state.width, state.owner?.retain());
}

export function releaseRegValueState(state: RegValueState): void {
  releaseOwner(state);
  setUnknown(state);
}

export function recordStableRegValue(
  state: RegValueState,
  local: number,
  width: OperandWidth,
  owner?: Owner | undefined
): void {
  const previousOwner = state.kind === "local" ? state.owner : undefined;

  setLocal(state, local, width, owner);

  if (previousOwner !== undefined && previousOwner !== owner) {
    previousOwner.release();
  }
}

export function clearRegValueState(state: RegValueState): void {
  releaseRegValueState(state);
}

export function moveRegValueState(target: RegValueState, source: RegValueState): void {
  if (target === source) {
    return;
  }

  const previousOwner = target.kind === "local" ? target.owner : undefined;
  const nextOwner = source.kind === "local" ? source.owner : undefined;

  if (source.kind === "unknown") {
    setUnknown(target);
  } else {
    setLocal(target, source.local, source.width, source.owner);
  }

  setUnknown(source);

  if (previousOwner !== undefined && previousOwner !== nextOwner) {
    previousOwner.release();
  }
}

export function exactSourceForAlias(
  state: RegValueState | undefined,
  alias: RegisterAlias
): LocalRegValueSource | undefined {
  if (state?.kind !== "local" || alias.bitOffset !== fullAliasOffset || alias.width > state.width) {
    return undefined;
  }

  return sourceWithoutOwner(state);
}

export function knownPrefixForAlias(
  state: RegValueState | undefined,
  alias: RegisterAlias
): LocalRegValueSource | undefined {
  if (state?.kind !== "local" || alias.bitOffset + alias.width > state.width) {
    return undefined;
  }

  return sourceWithoutOwner(state);
}

export function knownPrefixForReg(state: RegValueState | undefined): LocalRegValueSource | undefined {
  return state?.kind === "local" ? sourceWithoutOwner(state) : undefined;
}

export function retainedRegValueSource(source: LocalRegValueSource): LocalRegValueSource {
  return localRegValueSource(source.local, source.width, source.owner?.retain());
}

export function recordRegValueSource(state: RegValueState, source: LocalRegValueSource): void {
  recordStableRegValue(state, source.local, source.width, source.owner);
}

export function hasKnownPrefix(state: RegValueState | undefined): boolean {
  return state?.kind === "local";
}

export function hasFullValue(state: RegValueState | undefined): boolean {
  return state?.kind === "local" && state.width === fullWidth;
}

export function fullRegAccess(reg: Reg32): RegisterAlias {
  return { name: reg, base: reg, bitOffset: fullAliasOffset, width: fullWidth };
}

export function aliasOverlapsKnownPrefix(state: RegValueState | undefined, alias: RegisterAlias): boolean {
  return state?.kind === "local" && bitRangesOverlap(
    fullAliasOffset,
    state.width,
    alias.bitOffset,
    alias.width
  );
}

export function bitRangesOverlap(
  leftOffset: number,
  leftWidth: number,
  rightOffset: number,
  rightWidth: number
): boolean {
  return leftOffset < rightOffset + rightWidth && rightOffset < leftOffset + leftWidth;
}

function localRegValueSource(
  local: number,
  width: OperandWidth,
  owner?: Owner | undefined
): LocalRegValueState {
  return owner === undefined
    ? { kind: "local", local, width }
    : { kind: "local", local, width, owner };
}

function sourceWithoutOwner(state: LocalRegValueState): LocalRegValueSource {
  return state.owner === undefined
    ? { kind: "local", local: state.local, width: state.width }
    : { kind: "local", local: state.local, width: state.width, owner: state.owner };
}

function releaseOwner(state: RegValueState): void {
  if (state.kind === "local" && state.owner !== undefined) {
    state.owner.release();
  }
}

function setUnknown(state: RegValueState): void {
  const mutable = state as {
    kind: "unknown" | "local";
    local?: number;
    width?: OperandWidth;
    owner?: Owner | undefined;
  };

  mutable.kind = "unknown";
  delete mutable.local;
  delete mutable.width;
  delete mutable.owner;
}

function setLocal(
  state: RegValueState,
  local: number,
  width: OperandWidth,
  owner?: Owner | undefined
): void {
  const mutable = state as {
    kind: "unknown" | "local";
    local?: number;
    width?: OperandWidth;
    owner?: Owner | undefined;
  };

  mutable.kind = "local";
  mutable.local = local;
  mutable.width = width;

  if (owner === undefined) {
    delete mutable.owner;
  } else {
    mutable.owner = owner;
  }
}
