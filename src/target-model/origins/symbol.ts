import type { MojoOriginRef } from "./model.js";

export function mojoOriginSymbol(origin: MojoOriginRef): string | undefined {
  switch (origin.kind) {
    case "static": return "ImmStaticOrigin";
    case "untracked": return "UntrackedOrigin";
    case "unsafe": return "UnsafeAnyOrigin";
    case "inferred":
    case "parameter":
    case "provider-expression":
      return undefined;
  }
}
