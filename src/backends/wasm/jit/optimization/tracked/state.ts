import type { Reg32 } from "#x86/isa/types.js";
import type { ConditionCode } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitOptimizationContext } from "#backends/wasm/jit/optimization/tracked/context.js";
import {
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "#backends/wasm/jit/optimization/effects/effects.js";
import {
  JitFlagOwners,
  type JitFlagOwner,
  type JitFlagOwnerMask
} from "#backends/wasm/jit/optimization/flags/owners.js";
import type { JitFlagSource } from "#backends/wasm/jit/optimization/flags/sources.js";
import { JitRegisterValues } from "#backends/wasm/jit/optimization/registers/values.js";
import {
  materializeJitRegisterValue,
  type JitInstructionRewrite
} from "#backends/wasm/jit/optimization/ir/rewrite.js";
import type { JitValue } from "#backends/wasm/jit/optimization/ir/values.js";
import { jitValueReadsReg } from "#backends/wasm/jit/optimization/ir/values.js";

export type JitTrackedLocation =
  | Readonly<{ kind: "register"; reg: Reg32 }>
  | Readonly<{ kind: "flags"; mask: number }>;

export type JitTrackedProducer =
  | Readonly<{ kind: "registerValue"; value: JitValue }>
  | Readonly<{ kind: "incomingFlags" }>
  | Readonly<{ kind: "materializedFlags" }>
  | Readonly<{ kind: "flagSource"; source: JitFlagSource }>;

export type JitTrackedRead = Readonly<{
  location: JitTrackedLocation;
  reason: JitTrackedMaterializationReason;
  instructionIndex?: number;
  opIndex?: number;
  exitReason?: ExitReasonValue;
  cc?: ConditionCode;
  producers: readonly JitTrackedProducerOwnership[];
}>;

export type JitTrackedFlagReadRequest = Omit<JitTrackedRead, "location" | "producers"> & Readonly<{
  requiredMask: number;
}>;

export type JitTrackedWrite = Readonly<{
  location: JitTrackedLocation;
  producer?: JitTrackedProducer;
}>;

export type JitTrackedMaterializationReason =
  | "condition"
  | "materialize"
  | "boundary"
  | "preInstructionExit"
  | "exit"
  | "read"
  | "clobber";

export type JitTrackedMaterializationRequest =
  | Readonly<{
      kind: "locations";
      reason: JitTrackedMaterializationReason;
      locations: readonly JitTrackedLocation[];
    }>
  | Readonly<{
      kind: "registerDependencies";
      reason: "clobber";
      reg: Reg32;
    }>
  | Readonly<{
      kind: "allRegisters";
      reason: "preInstructionExit" | "exit";
    }>;

export type JitTrackedProducerOwnership = Readonly<{
  location: JitTrackedLocation;
  producer: JitTrackedProducer;
}>;

export function jitTrackedRegisterLocation(reg: Reg32): JitTrackedLocation {
  return { kind: "register", reg };
}

export function jitTrackedFlagsLocation(mask: number): JitTrackedLocation {
  return { kind: "flags", mask };
}

export class JitTrackedState {
  readonly registers = new JitRegisterValues();
  readonly flags = JitFlagOwners.incoming();

  constructor(readonly context: JitOptimizationContext) {}

  recordProducer(write: JitTrackedWrite): void {
    switch (write.location.kind) {
      case "register":
        this.recordRegisterProducer(write.location.reg, write.producer);
        return;
      case "flags":
        this.recordFlagProducer(write.location.mask, write.producer);
        return;
    }
  }

  recordRead(read: Omit<JitTrackedRead, "producers">): JitTrackedRead {
    return {
      ...read,
      producers: this.producersForLocation(read.location)
    };
  }

  recordFlagRead(
    read: JitTrackedFlagReadRequest,
    owners: JitFlagOwners = this.flags
  ): JitTrackedRead {
    const { requiredMask, ...trackedRead } = read;

    return {
      ...trackedRead,
      location: jitTrackedFlagsLocation(requiredMask),
      producers: owners.forMask(requiredMask).map((owner) => flagOwnerProducerOwnership(owner))
    };
  }

  recordClobber(location: JitTrackedLocation): void {
    switch (location.kind) {
      case "register":
        this.registers.delete(location.reg);
        return;
      case "flags":
        this.flags.recordMaterialized(location.mask);
        return;
    }
  }

  producersForLocation(location: JitTrackedLocation): readonly JitTrackedProducerOwnership[] {
    switch (location.kind) {
      case "register": {
        const value = this.registers.get(location.reg);

        return value === undefined
          ? []
          : [{ location, producer: { kind: "registerValue", value } }];
      }
      case "flags":
        return this.flags.forMask(location.mask).map((owner) => flagOwnerProducerOwnership(owner));
    }
  }

  recordRegisterValue(reg: Reg32, value: JitValue): void {
    this.recordProducer({
      location: jitTrackedRegisterLocation(reg),
      producer: { kind: "registerValue", value }
    });
  }

  recordRegisterRead(reg: Reg32): JitTrackedRead {
    this.registers.recordRead(reg);

    return this.recordRead({
      location: jitTrackedRegisterLocation(reg),
      reason: "read"
    });
  }

  recordFlagSource(source: JitFlagSource): void {
    this.recordProducer({
      location: jitTrackedFlagsLocation(source.writtenMask | source.undefMask),
      producer: { kind: "flagSource", source }
    });
  }

  recordFlagsMaterialized(mask: number): void {
    this.recordProducer({
      location: jitTrackedFlagsLocation(mask),
      producer: { kind: "materializedFlags" }
    });
  }

  cloneFlagOwners(): JitFlagOwners {
    return this.flags.clone();
  }

  flagOwnersForMask(mask: number): readonly JitFlagOwnerMask[] {
    return this.flags.forMask(mask);
  }

  flagProducerOwnersReadingReg(reg: Reg32): readonly JitFlagOwnerMask[] {
    return this.flags.producerOwnersReadingReg(reg);
  }

  recordRequiredMaterializations(
    request: JitTrackedMaterializationRequest
  ): readonly JitTrackedLocation[] {
    switch (request.kind) {
      case "allRegisters":
        return this.recordAllRegistersMaterialized();
      case "registerDependencies":
        return this.recordRegistersReadingRegMaterialized(request.reg);
      case "locations":
        return this.recordLocationsMaterialized(request.locations);
    }
  }

  recordRegistersForPreInstructionExits(
    instructionIndex: number
  ): readonly JitTrackedLocation[] {
    if (!jitInstructionHasPreInstructionExit(this.context.effects, instructionIndex)) {
      return [];
    }

    return this.recordRequiredMaterializations({
      kind: "allRegisters",
      reason: "preInstructionExit"
    });
  }

  recordRegistersForPostInstructionExit(
    instructionIndex: number,
    opIndex: number
  ): readonly JitTrackedLocation[] {
    if (!jitOpHasPostInstructionExit(this.context.effects, instructionIndex, opIndex)) {
      return [];
    }

    return this.recordRequiredMaterializations({
      kind: "allRegisters",
      reason: "exit"
    });
  }

  materializeRequiredLocations(
    rewrite: JitInstructionRewrite,
    request: JitTrackedMaterializationRequest
  ): number {
    switch (request.kind) {
      case "allRegisters":
        return this.materializeAllRegisters(rewrite);
      case "registerDependencies":
        return this.materializeRegistersReadingReg(rewrite, request.reg);
      case "locations":
        return this.materializeLocations(rewrite, request.locations);
    }
  }

  materializeRegistersForPreInstructionExits(
    rewrite: JitInstructionRewrite,
    instructionIndex: number
  ): number {
    if (!jitInstructionHasPreInstructionExit(this.context.effects, instructionIndex)) {
      return 0;
    }

    return this.materializeRequiredLocations(rewrite, {
      kind: "allRegisters",
      reason: "preInstructionExit"
    });
  }

  materializeRegistersForPostInstructionExit(
    rewrite: JitInstructionRewrite,
    instructionIndex: number,
    opIndex: number
  ): number {
    if (!jitOpHasPostInstructionExit(this.context.effects, instructionIndex, opIndex)) {
      return 0;
    }

    return this.materializeRequiredLocations(rewrite, {
      kind: "allRegisters",
      reason: "exit"
    });
  }

  private recordRegisterProducer(reg: Reg32, producer: JitTrackedProducer | undefined): void {
    if (producer?.kind === "registerValue") {
      this.registers.set(reg, producer.value);
      return;
    }

    this.registers.delete(reg);
  }

  private recordFlagProducer(mask: number, producer: JitTrackedProducer | undefined): void {
    if (producer?.kind === "flagSource") {
      this.flags.recordSource(producer.source);
      return;
    }

    this.flags.recordMaterialized(mask);
  }

  private materializeLocations(
    rewrite: JitInstructionRewrite,
    locations: readonly JitTrackedLocation[]
  ): number {
    let materializedSetCount = 0;

    for (const location of locations) {
      switch (location.kind) {
        case "register": {
          const value = this.registers.get(location.reg);

          if (value === undefined) {
            break;
          }

          materializeJitRegisterValue(rewrite, location.reg, value);
          this.registers.delete(location.reg);
          materializedSetCount += 1;
          break;
        }
        case "flags":
          this.flags.recordMaterialized(location.mask);
          break;
      }
    }

    return materializedSetCount;
  }

  private materializeRegistersReadingReg(
    rewrite: JitInstructionRewrite,
    readReg: Reg32
  ): number {
    let materializedSetCount = 0;

    for (const [reg, value] of [...this.registers.entries()]) {
      if (reg !== readReg && jitValueReadsReg(value, readReg)) {
        materializeJitRegisterValue(rewrite, reg, value);
        this.registers.delete(reg);
        materializedSetCount += 1;
      }
    }

    return materializedSetCount;
  }

  private materializeAllRegisters(rewrite: JitInstructionRewrite): number {
    const materializedSetCount = this.registers.size;

    for (const [reg, value] of this.registers.entries()) {
      materializeJitRegisterValue(rewrite, reg, value);
    }

    this.registers.clear();
    return materializedSetCount;
  }

  private recordLocationsMaterialized(
    locations: readonly JitTrackedLocation[]
  ): readonly JitTrackedLocation[] {
    const materializedLocations: JitTrackedLocation[] = [];

    for (const location of locations) {
      switch (location.kind) {
        case "register":
          if (!this.registers.has(location.reg)) {
            break;
          }

          this.registers.delete(location.reg);
          materializedLocations.push(location);
          break;
        case "flags":
          this.flags.recordMaterialized(location.mask);
          materializedLocations.push(location);
          break;
      }
    }

    return materializedLocations;
  }

  private recordRegistersReadingRegMaterialized(
    readReg: Reg32
  ): readonly JitTrackedLocation[] {
    const materializedLocations: JitTrackedLocation[] = [];

    for (const [reg, value] of [...this.registers.entries()]) {
      if (reg !== readReg && jitValueReadsReg(value, readReg)) {
        this.registers.delete(reg);
        materializedLocations.push(jitTrackedRegisterLocation(reg));
      }
    }

    return materializedLocations;
  }

  private recordAllRegistersMaterialized(): readonly JitTrackedLocation[] {
    const materializedLocations = [...this.registers.entries()].map(([reg]) =>
      jitTrackedRegisterLocation(reg)
    );

    this.registers.clear();
    return materializedLocations;
  }
}

function flagOwnerProducerOwnership(ownerMask: JitFlagOwnerMask): JitTrackedProducerOwnership {
  return {
    location: { kind: "flags", mask: ownerMask.mask },
    producer: flagOwnerProducer(ownerMask.owner)
  };
}

function flagOwnerProducer(owner: JitFlagOwner): JitTrackedProducer {
  switch (owner.kind) {
    case "incoming":
      return { kind: "incomingFlags" };
    case "materialized":
      return { kind: "materializedFlags" };
    case "producer":
      return { kind: "flagSource", source: owner.source };
  }
}
