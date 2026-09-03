import type { MojoTargetTypeRef } from "./model.js";

export function mojoNumericLiteralCanInitialize(
  text: string,
  target: MojoTargetTypeRef,
): boolean {
  if (target.kind !== "source-primitive" || target.name === "bool" ||
    target.name === "char" || target.name === "decimal") return false;
  const value = integerLiteralValue(text);
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  if (target.name === "float16" || target.name === "float32" || target.name === "float64") {
    return true;
  }
  if (target.name === "native-int") return value <= (1n << 63n) - 1n;
  if (target.name === "native-uint") return value <= (1n << 64n) - 1n;
  const bounds = integerBounds(target.name);
  return bounds !== undefined && value >= bounds[0] && value <= bounds[1];
}

function integerLiteralValue(text: string): bigint | undefined {
  const normalized = text.replace(/_/gu, "");
  if (!/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[0-9]+)$/u.test(normalized)) {
    return undefined;
  }
  return BigInt(normalized);
}

function integerBounds(
  name: Extract<MojoTargetTypeRef, { readonly kind: "source-primitive" }>["name"],
): readonly [bigint, bigint] | undefined {
  switch (name) {
    case "int8": return [-(1n << 7n), (1n << 7n) - 1n];
    case "uint8": return [0n, (1n << 8n) - 1n];
    case "int16": return [-(1n << 15n), (1n << 15n) - 1n];
    case "uint16": return [0n, (1n << 16n) - 1n];
    case "int32": return [-(1n << 31n), (1n << 31n) - 1n];
    case "uint32": return [0n, (1n << 32n) - 1n];
    case "int64": return [-(1n << 63n), (1n << 63n) - 1n];
    case "uint64": return [0n, (1n << 64n) - 1n];
    case "int128": return [-(1n << 127n), (1n << 127n) - 1n];
    case "uint128": return [0n, (1n << 128n) - 1n];
    case "bool":
    case "char":
    case "native-int":
    case "native-uint":
    case "float16":
    case "float32":
    case "float64":
    case "decimal": return undefined;
  }
}
