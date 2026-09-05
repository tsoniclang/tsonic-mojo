import type { MojoOriginRef, MojoOriginToken } from "./model.js";

export function mojoOriginEquals(left: MojoOriginRef, right: MojoOriginRef): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "static":
    case "comptime":
    case "inferred":
      return true;
    case "untracked":
    case "unsafe":
      return right.kind === left.kind && left.mutable === right.mutable;
    case "parameter":
      return right.kind === "parameter" && left.name === right.name;
    case "provider-expression":
      return right.kind === "provider-expression" && tokensEqual(left.tokens, right.tokens);
  }
}

export function mojoOriginKey(origin: MojoOriginRef): string {
  switch (origin.kind) {
    case "static":
    case "comptime":
    case "inferred":
      return origin.kind;
    case "untracked":
    case "unsafe":
      return `${origin.kind}:${origin.mutable ? "mut" : "imm"}`;
    case "parameter":
      return `parameter:${origin.name}`;
    case "provider-expression":
      return `provider:${origin.tokens.map((token) => `${token.kind}:${token.text}`).join("\u0000")}`;
  }
}

function tokensEqual(left: readonly MojoOriginToken[], right: readonly MojoOriginToken[]): boolean {
  return left.length === right.length && left.every((token, index) => {
    const other = right[index];
    return other !== undefined && token.kind === other.kind && token.text === other.text;
  });
}
