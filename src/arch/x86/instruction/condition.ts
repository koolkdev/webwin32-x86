export const jccConditions = [
  "jo",
  "jno",
  "jb",
  "jae",
  "jz",
  "jnz",
  "jbe",
  "ja",
  "js",
  "jns",
  "jp",
  "jnp",
  "jl",
  "jge",
  "jle",
  "jg"
] as const;

export type JccCondition = (typeof jccConditions)[number];
