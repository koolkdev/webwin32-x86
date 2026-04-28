export const wasmExternalKind = {
  function: 0x00,
  memory: 0x02
} as const;

export const wasmFunctionTypePrefix = 0x60;

export const wasmMagic = [0x00, 0x61, 0x73, 0x6d] as const;

export const wasmOpcode = {
  localGet: 0x20,
  localSet: 0x21,
  localTee: 0x22,
  i32Load: 0x28,
  i32Store: 0x36,
  i32Eqz: 0x45,
  i32LtU: 0x49,
  i32Const: 0x41,
  i64Const: 0x42,
  i32Popcnt: 0x69,
  i32Add: 0x6a,
  i32Sub: 0x6b,
  i32And: 0x71,
  i32Or: 0x72,
  i32Xor: 0x73,
  i32Shl: 0x74,
  end: 0x0b
} as const;

export const wasmSectionId = {
  type: 1,
  import: 2,
  function: 3,
  export: 7,
  code: 10
} as const;

export const wasmValueType = {
  i32: 0x7f,
  i64: 0x7e
} as const;

export const wasmVersion = [0x01, 0x00, 0x00, 0x00] as const;

export type WasmValueType = (typeof wasmValueType)[keyof typeof wasmValueType];

export type WasmFunctionType = Readonly<{
  params: readonly WasmValueType[];
  results: readonly WasmValueType[];
}>;
