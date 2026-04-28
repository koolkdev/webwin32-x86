export const opcode = {
  addRm32R32: 0x01,
  addR32Rm32: 0x03,
  escape: 0x0f,
  subRm32R32: 0x29,
  subR32Rm32: 0x2b,
  xorRm32R32: 0x31,
  xorR32Rm32: 0x33,
  cmpRm32R32: 0x39,
  cmpR32Rm32: 0x3b,
  pushR32Base: 0x50,
  pushR32Last: 0x57,
  popR32Base: 0x58,
  popR32Last: 0x5f,
  pushImm32: 0x68,
  pushImm8: 0x6a,
  jccRel8Base: 0x70,
  jccRel8Last: 0x7f,
  group81: 0x81,
  group83: 0x83,
  testRm32R32: 0x85,
  movRm32R32: 0x89,
  movR32Rm32: 0x8b,
  leaR32M: 0x8d,
  nop: 0x90,
  movR32Imm32Base: 0xb8,
  movR32Imm32Last: 0xbf,
  retImm16: 0xc2,
  retNear: 0xc3,
  int: 0xcd,
  callRel32: 0xe8,
  jmpRel32: 0xe9,
  jmpRel8: 0xeb
} as const;

export const opcodeMap0f = {
  jccRel32Base: 0x80,
  jccRel32Last: 0x8f
} as const;

export const movR32Imm32Length = 5;
