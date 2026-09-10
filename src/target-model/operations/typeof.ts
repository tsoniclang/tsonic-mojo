import type { MojoTargetTypeRef } from "../types/model.js";

export type MojoRuntimeCategory =
  | "undefined" | "object" | "boolean" | "number"
  | "bigint" | "string" | "symbol" | "function";

export type MojoTypeofSelection =
  | { readonly kind: "constant"; readonly value: MojoRuntimeCategory }
  | { readonly kind: "optional"; readonly present: MojoTypeofSelection }
  | { readonly kind: "union"; readonly members: readonly {
      readonly type: MojoTargetTypeRef;
      readonly selection: MojoTypeofSelection;
    }[] }
  | { readonly kind: "js-value" };
