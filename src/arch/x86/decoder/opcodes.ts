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
  testRm32R32: 0x85,
  movRm32R32: 0x89,
  movR32Rm32: 0x8b,
  nop: 0x90,
  movR32Imm32Base: 0xb8,
  movR32Imm32Last: 0xbf,
  int: 0xcd
} as const;

export const movR32Imm32Length = 5;
