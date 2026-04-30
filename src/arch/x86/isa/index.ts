import { defineIsa } from "./schema/builders.js";
import { ADD, SUB, XOR } from "./defs/alu.js";
import { CALL, JCC, JMP, RET } from "./defs/control.js";
import { CMP, TEST } from "./defs/cmp-test.js";
import { LEA } from "./defs/lea.js";
import { INT, NOP } from "./defs/misc.js";
import { MOV } from "./defs/mov.js";
import { POP, PUSH } from "./defs/stack.js";

export const X86_32_CORE = defineIsa({
  name: "x86-32-core",
  mnemonics: [NOP, MOV, LEA, ADD, SUB, XOR, CMP, TEST, PUSH, POP, JMP, CALL, RET, INT, ...JCC]
});

export type X86CoreInstruction = (typeof X86_32_CORE.instructions)[number];
