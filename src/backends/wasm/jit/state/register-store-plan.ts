import type { LocalLaneSource, RegValueState } from "./register-lanes.js";
import {
  allBytesKnown,
  byteCount,
  exactFullLocal,
  hasKnownBytes,
  isLocalBackedByteLane
} from "./register-lanes.js";

export type RegisterStoreOp =
  | Readonly<{ kind: "store8"; byteIndex: number; source: LocalLaneSource }>
  | Readonly<{ kind: "store16"; byteIndex: number; sources: readonly [LocalLaneSource, LocalLaneSource] }>;

export type RegisterStorePlan =
  | Readonly<{ kind: "store32" }>
  | Readonly<{ kind: "partial"; stores: readonly RegisterStoreOp[] }>;

export function planRegisterExitStore(state: RegValueState): RegisterStorePlan {
  if (exactFullLocal(state) !== undefined || allBytesKnown(state) || !hasKnownBytes(state)) {
    return { kind: "store32" };
  }

  const stores: RegisterStoreOp[] = [];
  let byteIndex = 0;

  while (byteIndex < byteCount) {
    const source = state.bytes[byteIndex];

    if (!isLocalBackedByteLane(source)) {
      byteIndex += 1;
      continue;
    }

    const nextSource = state.bytes[byteIndex + 1];

    if (isLocalBackedByteLane(nextSource)) {
      stores.push({
        kind: "store16",
        byteIndex,
        sources: [source.source, nextSource.source]
      });
      byteIndex += 2;
      continue;
    }

    stores.push({
      kind: "store8",
      byteIndex,
      source: source.source
    });
    byteIndex += 1;
  }

  return { kind: "partial", stores };
}
