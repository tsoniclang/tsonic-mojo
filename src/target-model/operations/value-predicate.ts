import type { MojoTargetTypeRef } from "../types/model.js";

export interface MojoNativeValuePredicate {
  readonly acceptedType: MojoTargetTypeRef;
  readonly boxed: {
    readonly modulePath: readonly string[];
    readonly name: string;
  };
}

export type MojoValuePredicateSelection =
  | { readonly kind: "constant"; readonly value: boolean }
  | { readonly kind: "boxed"; readonly operation: MojoNativeValuePredicate["boxed"] }
  | { readonly kind: "optional"; readonly present: MojoValuePredicateSelection }
  | {
      readonly kind: "union";
      readonly members: readonly {
        readonly type: MojoTargetTypeRef;
        readonly selection: MojoValuePredicateSelection;
      }[];
    };
