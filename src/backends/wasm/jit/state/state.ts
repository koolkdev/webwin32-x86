import { i32 } from "#x86/state/cpu-state.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { emitLoadStateU32, emitStoreStateU32 } from "#backends/wasm/codegen/state.js";
import type { JitExitPoint, JitExitStoreSnapshotPlan, JitStateSnapshot } from "#backends/wasm/jit/codegen/plan/types.js";
import { createJitFlagState, type JitFlagState } from "./flag-state.js";
import {
  createJitReg32State,
  type JitReg32InstructionOptions,
  type JitReg32State,
  type JitReg32ExitStoreSnapshot
} from "./register-state.js";
import type { JitValueCacheRuntime } from "#backends/wasm/jit/codegen/emit/value-local-store.js";

export type JitExitTarget = {
  exitLocal: number;
  exitLabelDepth: number;
  emitBeforeExit?: () => void;
};

type ExitMetadataStoreOptions = Readonly<{
  allowPendingFlags?: boolean;
}>;

type JitIrStateOptions = Readonly<{
  valueCache?: JitValueCacheRuntime | undefined;
}>;

export type JitIrState = Readonly<{
  regs: JitReg32State;
  flags: JitFlagState;
  eipLocal: number;
  aluFlagsLocal: number;
  instructionCountLocal: number;
  maxExitStoreSnapshotIndex: number;
  emitLoadInstructionCount(): void;
  beginInstruction(exit: JitExitTarget, snapshot: JitStateSnapshot, options: JitReg32InstructionOptions): void;
  prepareExitPoint(exitPoint: JitExitPoint, emitEip: () => void): void;
  finishPreInstructionExitPoints(): void;
  commitInstruction(): void;
  commitInstructionExit(exitPoint: JitExitPoint, emitEip: () => void): void;
  emitExitStoreSnapshotStores(index: number): void;
}>;

export function createJitIrState(
  body: WasmFunctionBodyEncoder,
  exitStoreSnapshots: readonly JitExitStoreSnapshotPlan[],
  options: JitIrStateOptions = {}
): JitIrState {
  const regs = createJitReg32State(body);
  const maxExitStoreSnapshotIndex = exitStoreSnapshots.length - 1;
  const eipLocal = body.addLocal(wasmValueType.i32);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags,
    emitLoadAluFlagsValue,
    emitStoreAluFlags,
    valueCache: options.valueCache
  });
  const instructionCountLocal = body.addLocal(wasmValueType.i32);
  const exitRegisterStoreSnapshots = new Map<number, JitReg32ExitStoreSnapshot>();
  let activeExit: JitExitTarget | undefined;

  return {
    regs,
    flags,
    eipLocal,
    aluFlagsLocal,
    instructionCountLocal,
    maxExitStoreSnapshotIndex,
    emitLoadInstructionCount: () => {
      emitLoadStateU32(body, stateOffset.instructionCount);
      body.localSet(instructionCountLocal);
    },
    beginInstruction: (exit, snapshot, options) => {
      activeExit = exit;
      regs.beginInstruction(options);
      useExitStoreSnapshot(exit, 0);
      installExitMetadataStores(exit, () => {
        body.i32Const(i32(snapshot.eip));
      }, snapshot.instructionCountDelta);
    },
    prepareExitPoint: (exitPoint, emitEip) => {
      const exit = requiredActiveExit();

      useExitStoreSnapshot(exit, exitPoint.exitStoreSnapshotIndex);
      captureExitRegisterStoreSnapshot(exitPoint.exitStoreSnapshotIndex);
      installExitMetadataStores(exit, emitEip, exitPoint.snapshot.instructionCountDelta, {
        allowPendingFlags: exitPoint.snapshot.kind === "preInstruction"
      });
    },
    finishPreInstructionExitPoints: () => {
      regs.commitPending();
    },
    commitInstruction,
    commitInstructionExit: (exitPoint, emitEip) => {
      const exit = requiredActiveExit();

      emitEip();
      body.localSet(eipLocal);
      regs.commitPending();
      captureExitRegisterStoreSnapshot(exitPoint.exitStoreSnapshotIndex);
      useExitStoreSnapshot(exit, exitPoint.exitStoreSnapshotIndex);
      installExitMetadataStores(exit, () => {
        body.localGet(eipLocal);
      }, exitPoint.snapshot.instructionCountDelta);
    },
    emitExitStoreSnapshotStores: (index) => {
      const snapshot = exitStoreSnapshots[index];

      if (snapshot === undefined) {
        throw new Error(`missing JIT exit store snapshot: ${index}`);
      }

      if (snapshot.regs.length === 0) {
        return;
      }

      const registerSnapshot = exitRegisterStoreSnapshots.get(index);

      if (registerSnapshot === undefined) {
        throw new Error(`JIT exit store snapshot was not captured: ${index}`);
      }

      for (const reg of snapshot.regs) {
        regs.emitExitSnapshotStore(reg, registerSnapshot);
      }
    }
  };

  function commitInstruction(): void {
    regs.commitPending();
  }

  function emitLoadAluFlags(): void {
    emitLoadAluFlagsValue();
    body.localSet(aluFlagsLocal);
  }

  function emitLoadAluFlagsValue(): void {
    emitLoadStateU32(body, stateOffset.aluFlags);
  }

  function emitStoreAluFlags(emitValue: () => void): void {
    emitStoreStateU32(body, stateOffset.aluFlags, emitValue);
  }

  function installExitMetadataStores(
    exit: JitExitTarget,
    emitEip: () => void,
    instructionDelta: number,
    options: ExitMetadataStoreOptions = {}
  ): void {
    exit.emitBeforeExit = () => {
      emitStoreStateU32(body, stateOffset.eip, emitEip);
      emitStoreStateU32(body, stateOffset.instructionCount, () => {
        body.localGet(instructionCountLocal);

        if (instructionDelta !== 0) {
          body.i32Const(instructionDelta).i32Add();
        }
      });

      if (options.allowPendingFlags !== true) {
        flags.assertNoPending();
      }
    };
  }

  function useExitStoreSnapshot(exit: JitExitTarget, index: number): void {
    exit.exitLabelDepth = maxExitStoreSnapshotIndex - index;
  }

  function captureExitRegisterStoreSnapshot(index: number): void {
    const snapshot = exitStoreSnapshots[index];

    if (snapshot === undefined || snapshot.regs.length === 0) {
      return;
    }

    // Deferred exit blocks store this snapshot after later code may have run.
    // Capture lane/local sources at the exit point.
    exitRegisterStoreSnapshots.set(index, regs.captureCommittedExitStores(snapshot.regs));
  }

  function requiredActiveExit(): JitExitTarget {
    if (activeExit === undefined) {
      throw new Error("JIT instruction exit requested before beginInstruction");
    }

    return activeExit;
  }
}
