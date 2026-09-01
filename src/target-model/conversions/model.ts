import type { MojoTargetTypeRef } from "../types/model.js";

export type MojoValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "callable-raise-widen"; readonly targetType: MojoTargetTypeRef }
  | {
      readonly kind: "js-callback-truthiness";
      readonly targetType: MojoTargetTypeRef;
      readonly source: "number" | "string" | "dynamic" | "always-true" | "always-false";
      readonly widenRaises: boolean;
    }
  | { readonly kind: "primitive-cast"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "reference-copy"; readonly targetType: MojoTargetTypeRef }
  | {
      readonly kind: "js-box";
      readonly targetType: MojoTargetTypeRef;
      readonly source: "bool" | "number" | "string" | "null" | "undefined";
    }
  | { readonly kind: "native-to-js-string"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-to-native-string" }
  | { readonly kind: "list-to-js-array"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-array-to-list"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "optional-none"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "optional-some"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "union-inject"; readonly targetType: MojoTargetTypeRef };
