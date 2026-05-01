export const RuntimeMode = {
  INTERPRETER: "interpreter",
  COMPILED_BLOCKS: "compiled-blocks"
} as const;

export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode];

const runtimeModes = new Set<string>(Object.values(RuntimeMode));

export function isRuntimeMode(value: string): value is RuntimeMode {
  return runtimeModes.has(value);
}

export function parseRuntimeMode(value: string): RuntimeMode {
  if (isRuntimeMode(value)) {
    return value;
  }

  throw new RangeError(`unknown runtime mode: ${value}`);
}
