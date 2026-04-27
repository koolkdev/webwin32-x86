export const opcode = {
  escape: 0x0f,
  movRm32R32: 0x89,
  movR32Rm32: 0x8b,
  nop: 0x90,
  movR32Imm32Base: 0xb8,
  movR32Imm32Last: 0xbf,
  int: 0xcd
} as const;

export const movR32Imm32Length = 5;
