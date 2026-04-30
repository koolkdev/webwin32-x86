import { strictEqual } from "node:assert";
import { test } from "node:test";

import { interpreterOpcodeDispatchRoot } from "../dispatch.js";

test("interpreter dispatch includes one-byte opcode forms from the ISA", () => {
  strictEqual(interpreterOpcodeDispatchRoot.next[0xb8]?.leaf?.opcodeLength, 1);
});

test("interpreter dispatch includes two-byte opcode forms from the ISA", () => {
  strictEqual(interpreterOpcodeDispatchRoot.next[0x0f]?.next[0x85]?.leaf?.opcodeLength, 2);
});
