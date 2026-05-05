import type { ByteSource, RegValueState } from "./register-lanes.js";
import { byteCount, hasPartialBytes } from "./register-lanes.js";

export type RegisterStoreOp =
  | Readonly<{ kind: "store8"; byteIndex: number; source: ByteSource }>
  | Readonly<{ kind: "store16"; byteIndex: number; sources: readonly [ByteSource, ByteSource] }>;

export type RegisterStorePlan =
  | Readonly<{ kind: "store32" }>
  | Readonly<{ kind: "partial"; stores: readonly RegisterStoreOp[] }>;

export function planRegisterExitStore(state: RegValueState): RegisterStorePlan {
  if (state.fullLocal !== undefined || !hasPartialBytes(state)) {
    return { kind: "store32" };
  }

  const stores: RegisterStoreOp[] = [];
  let byteIndex = 0;

  while (byteIndex < byteCount) {
    const source = state.bytes[byteIndex];

    if (source === undefined) {
      byteIndex += 1;
      continue;
    }

    const nextSource = state.bytes[byteIndex + 1];

    if (nextSource !== undefined) {
      stores.push({
        kind: "store16",
        byteIndex,
        sources: [source, nextSource]
      });
      byteIndex += 2;
      continue;
    }

    stores.push({
      kind: "store8",
      byteIndex,
      source
    });
    byteIndex += 1;
  }

  return { kind: "partial", stores };
}
