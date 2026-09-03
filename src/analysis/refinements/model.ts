import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoValueRefinementSelection =
  | {
      readonly kind: "optional-present";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "union-member";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "union-subset";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly resultType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
    }
  | {
      readonly kind: "project-downcast";
      readonly sourceType: MojoTargetTypeRef;
      readonly dispatchType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    };
