import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { interpreterWasmArtifactPath } from "./artifact.js";
import { encodeInterpreterModule } from "./module.js";

const bytes = encodeInterpreterModule();

mkdirSync(dirname(interpreterWasmArtifactPath), { recursive: true });
writeFileSync(interpreterWasmArtifactPath, bytes);

console.log(`wrote ${bytes.byteLength} bytes to ${interpreterWasmArtifactPath}`);
