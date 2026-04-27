export const wasmExternalKind = {
  function: 0x00,
  memory: 0x02
} as const;

export const wasmFunctionTypePrefix = 0x60;

export const wasmMagic = [0x00, 0x61, 0x73, 0x6d] as const;

export const wasmOpcode = {
  localGet: 0x20,
  i32Load: 0x28,
  i32Store: 0x36,
  i32Const: 0x41,
  i64Const: 0x42,
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
