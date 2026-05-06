import type { LocalLaneSource, RegValueState } from "./register-lanes.js";
import {
  allBytesHaveLocalValues,
  byteCount,
  exactFullLocalSource,
  hasPartialLocalValues,
  isLocalBackedLaneValue
} from "./register-lanes.js";

export type RegisterStoreOp =
  | Readonly<{ kind: "store8"; byteIndex: number; source: LocalLaneSource }>
  | Readonly<{ kind: "store16"; byteIndex: number; sources: readonly [LocalLaneSource, LocalLaneSource] }>;

export type RegisterStorePlan =
  | Readonly<{ kind: "store32" }>
  | Readonly<{ kind: "partial"; stores: readonly RegisterStoreOp[] }>;

export function planRegisterExitStore(state: RegValueState): RegisterStorePlan {
  if (exactFullLocalSource(state) !== undefined || allBytesHaveLocalValues(state) || !hasPartialLocalValues(state)) {
    return { kind: "store32" };
  }

  const stores: RegisterStoreOp[] = [];
  let byteIndex = 0;

  while (byteIndex < byteCount) {
    const source = state.bytes[byteIndex];

    if (!isLocalBackedLaneValue(source)) {
      byteIndex += 1;
      continue;
    }

    const nextSource = state.bytes[byteIndex + 1];

    if (isLocalBackedLaneValue(nextSource)) {
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
