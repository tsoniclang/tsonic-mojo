import type { MojoCallArgumentConvention } from "../types/model.js";

export type MojoParameterDisposition =
  | { readonly kind: "immutable"; readonly localCopy: boolean }
  | { readonly kind: "mutable-reference" }
  | { readonly kind: "parametric-reference" }
  | { readonly kind: "owned" }
  | { readonly kind: "out" };

export type MojoArgumentDisposition =
  | { readonly kind: "plain" }
  | { readonly kind: "copy" }
  | { readonly kind: "transfer" };

export function mojoParameterConvention(
  disposition: MojoParameterDisposition,
): Exclude<MojoCallArgumentConvention, "deinit"> {
  switch (disposition.kind) {
    case "immutable": return "imm";
    case "mutable-reference": return "mut";
    case "parametric-reference": return "ref";
    case "owned": return "var";
    case "out": return "out";
  }
}

export function mojoParameterArgumentDisposition(
  disposition: MojoParameterDisposition,
): MojoArgumentDisposition {
  return disposition.kind === "owned"
    ? Object.freeze({ kind: "transfer" })
    : Object.freeze({ kind: "plain" });
}
