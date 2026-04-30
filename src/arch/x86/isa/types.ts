export const reg32 = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"] as const;

export type Reg32 = (typeof reg32)[number];

export type Mem32Operand = Readonly<{
  kind: "mem32";
  base?: Reg32;
  index?: Reg32;
  scale: 1 | 2 | 4 | 8;
  disp: number;
}>;
