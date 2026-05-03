import type { ValueRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitConditionUses,
  indexJitExitConditionValues,
  indexJitLocalConditionValues,
  type JitConditionUse
} from "./condition-uses.js";
import { walkJitIrBlockOps } from "./ir-walk.js";
import { jitMemoryFaultReason, jitPostInstructionExitReasons } from "./op-effects.js";
import { setJitOpIndexValue, type JitOpIndex } from "./op-index.js";

export type JitOptimizationEvent =
  | Readonly<{ kind: "preInstructionExit"; exitReason: ExitReasonValue }>
  | Readonly<{ kind: "postInstructionExit"; exitReasons: readonly ExitReasonValue[] }>
  | Readonly<{ kind: "conditionRead"; conditionUse: JitConditionUse }>
  | Readonly<{ kind: "localCondition"; values: readonly ValueRef[] }>
  | Readonly<{ kind: "exitCondition"; values: readonly ValueRef[] }>;

export type JitOptimizationEventIndex = JitOpIndex<readonly JitOptimizationEvent[]>;

type JitOptimizationEventSources = Readonly<{
  preInstructionExits: JitOpIndex<ExitReasonValue>;
  postInstructionExits: JitOpIndex<readonly ExitReasonValue[]>;
  localConditionValues: JitOpIndex<readonly ValueRef[]>;
  exitConditionValues: JitOpIndex<readonly ValueRef[]>;
  conditionUses: JitOpIndex<JitConditionUse>;
}>;

export function indexJitOptimizationEvents(
  block: JitIrBlock
): JitOptimizationEventIndex {
  const localConditionValues = indexJitLocalConditionValues(block);
  const exitConditionValues = indexJitExitConditionValues(block);

  return indexJitOptimizationEventsFromSources({
    preInstructionExits: indexJitPreInstructionExits(block),
    postInstructionExits: indexJitPostInstructionExits(block),
    localConditionValues,
    exitConditionValues,
    conditionUses: analyzeJitConditionUses(block, localConditionValues, exitConditionValues)
  });
}

function indexJitOptimizationEventsFromSources(
  analysis: JitOptimizationEventSources
): JitOptimizationEventIndex {
  const events = new Map<number, Map<number, readonly JitOptimizationEvent[]>>();

  addIndexedEvents(analysis.preInstructionExits, events, (exitReason) => ({
    kind: "preInstructionExit",
    exitReason
  }));
  addIndexedEvents(analysis.postInstructionExits, events, (exitReasons) => ({
    kind: "postInstructionExit",
    exitReasons
  }));
  addConditionValueEvents(analysis.localConditionValues, events, "localCondition");
  addConditionValueEvents(analysis.exitConditionValues, events, "exitCondition");
  addConditionReadEvents(analysis.conditionUses, events);

  return events;
}

function indexJitPreInstructionExits(block: JitIrBlock): JitOpIndex<ExitReasonValue> {
  const preInstructionExits = new Map<number, Map<number, ExitReasonValue>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const faultReason = jitMemoryFaultReason(op, instruction.operands);

    if (faultReason !== undefined) {
      setJitOpIndexValue(preInstructionExits, location.instructionIndex, location.opIndex, faultReason);
    }
  }, "indexing pre-instruction exits");

  return preInstructionExits;
}

function indexJitPostInstructionExits(block: JitIrBlock): JitOpIndex<readonly ExitReasonValue[]> {
  const postInstructionExits = new Map<number, Map<number, readonly ExitReasonValue[]>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const exitReasons = jitPostInstructionExitReasons(op, instruction);

    if (exitReasons.length !== 0) {
      setJitOpIndexValue(postInstructionExits, location.instructionIndex, location.opIndex, exitReasons);
    }
  }, "indexing post-instruction exits");

  return postInstructionExits;
}

export function jitEventsAt(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number
): readonly JitOptimizationEvent[] {
  return events.get(instructionIndex)?.get(opIndex) ?? [];
}

export function jitEventAt<K extends JitOptimizationEvent["kind"]>(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number,
  kind: K
): Extract<JitOptimizationEvent, { kind: K }> | undefined {
  return jitEventsAt(events, instructionIndex, opIndex).find((entry): entry is Extract<JitOptimizationEvent, { kind: K }> =>
    entry.kind === kind
  );
}

export function jitConditionValuesAt(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number,
  kind: "localCondition" | "exitCondition"
): readonly ValueRef[] {
  return jitEventAt(events, instructionIndex, opIndex, kind)?.values ?? [];
}

export function jitPreInstructionExitReasonAt(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number
): ExitReasonValue | undefined {
  return jitEventAt(events, instructionIndex, opIndex, "preInstructionExit")?.exitReason;
}

export function jitPostInstructionExitReasonsAt(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number
): readonly ExitReasonValue[] {
  return jitEventAt(events, instructionIndex, opIndex, "postInstructionExit")?.exitReasons ?? [];
}

export function jitOpHasPostInstructionExit(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number
): boolean {
  return jitPostInstructionExitReasonsAt(events, instructionIndex, opIndex).length !== 0;
}

export function jitConditionUseAt(
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number
): JitConditionUse | undefined {
  return jitEventAt(events, instructionIndex, opIndex, "conditionRead")?.conditionUse;
}

export function jitInstructionHasPreInstructionExit(
  events: JitOptimizationEventIndex,
  instructionIndex: number
): boolean {
  return jitLastPreInstructionExitOpIndex(events, instructionIndex) !== undefined;
}

export function jitFirstOpIndexAfterPreInstructionExits(
  events: JitOptimizationEventIndex,
  instructionIndex: number
): number {
  const lastPreInstructionExitOpIndex = jitLastPreInstructionExitOpIndex(events, instructionIndex);

  return lastPreInstructionExitOpIndex === undefined ? 0 : lastPreInstructionExitOpIndex + 1;
}

export function jitLastPreInstructionExitOpIndex(
  events: JitOptimizationEventIndex,
  instructionIndex: number
): number | undefined {
  let lastPreInstructionExitOpIndex: number | undefined;

  for (const [opIndex, opEvents] of events.get(instructionIndex)?.entries() ?? []) {
    if (opEvents.some((entry) => entry.kind === "preInstructionExit")) {
      lastPreInstructionExitOpIndex = Math.max(lastPreInstructionExitOpIndex ?? opIndex, opIndex);
    }
  }

  return lastPreInstructionExitOpIndex;
}

function addConditionValueEvents(
  valuesByLocation: JitOpIndex<readonly ValueRef[]>,
  events: Map<number, Map<number, readonly JitOptimizationEvent[]>>,
  kind: "localCondition" | "exitCondition"
): void {
  for (const [instructionIndex, valuesByOp] of valuesByLocation) {
    for (const [opIndex, values] of valuesByOp) {
      addEvent(events, instructionIndex, opIndex, { kind, values });
    }
  }
}

function addConditionReadEvents(
  conditionUses: JitOpIndex<JitConditionUse>,
  events: Map<number, Map<number, readonly JitOptimizationEvent[]>>
): void {
  for (const [instructionIndex, usesByOp] of conditionUses) {
    for (const [opIndex, conditionUse] of usesByOp) {
      addEvent(events, instructionIndex, opIndex, { kind: "conditionRead", conditionUse });
    }
  }
}

function addIndexedEvents<T>(
  index: JitOpIndex<T>,
  events: Map<number, Map<number, readonly JitOptimizationEvent[]>>,
  createEvent: (value: T) => JitOptimizationEvent
): void {
  for (const [instructionIndex, valuesByOp] of index) {
    for (const [opIndex, value] of valuesByOp) {
      addEvent(events, instructionIndex, opIndex, createEvent(value));
    }
  }
}

function addEvent(
  events: Map<number, Map<number, readonly JitOptimizationEvent[]>>,
  instructionIndex: number,
  opIndex: number,
  event: JitOptimizationEvent
): void {
  let instructionEvents = events.get(instructionIndex);

  if (instructionEvents === undefined) {
    instructionEvents = new Map();
    events.set(instructionIndex, instructionEvents);
  }

  instructionEvents.set(opIndex, [
    ...(instructionEvents.get(opIndex) ?? []),
    event
  ]);
}
