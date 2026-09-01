import type { MojoTargetTypeRef } from "../types/model.js";

export type MojoValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "primitive-cast"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "native-to-js-string"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-to-native-string" }
  | { readonly kind: "optional-none"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "optional-some"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "union-inject"; readonly targetType: MojoTargetTypeRef };
