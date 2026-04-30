import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const interpreterWasmArtifactPath = fileURLToPath(
  new URL("./generated/static-interpreter.wasm", import.meta.url)
);

export function readInterpreterWasmArtifact(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(readFileSync(interpreterWasmArtifactPath));
}
