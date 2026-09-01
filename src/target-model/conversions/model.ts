import type { MojoTargetTypeRef } from "../types/model.js";

export type MojoTruthinessConversion =
  | { readonly kind: "integer" }
  | { readonly kind: "float" }
  | { readonly kind: "string" }
  | { readonly kind: "dynamic" }
  | { readonly kind: "always-true" }
  | { readonly kind: "always-false" }
  | {
      readonly kind: "optional";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly value: MojoTruthinessConversion;
    }
  | {
      readonly kind: "union";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly members: readonly {
        readonly type: MojoTargetTypeRef;
        readonly conversion: MojoTruthinessConversion;
      }[];
    };

export type MojoValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "callable-raise-widen"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "callable-error-erase"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-truthiness"; readonly conversion: MojoTruthinessConversion }
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
  | {
      readonly kind: "collection-map";
      readonly sourceType: MojoTargetTypeRef;
      readonly targetType: MojoTargetTypeRef;
      readonly source: "list" | "js-array";
      readonly target: "list" | "js-array";
      readonly sourceElementType: MojoTargetTypeRef;
      readonly targetElementType: MojoTargetTypeRef;
      readonly elementConversion?: MojoValueConversion;
    }
  | { readonly kind: "optional-none"; readonly targetType: MojoTargetTypeRef }
  | {
      readonly kind: "optional-some";
      readonly targetType: MojoTargetTypeRef;
      readonly valueConversion: MojoValueConversion;
    }
  | {
      readonly kind: "optional-map";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly targetType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly valueConversion: MojoValueConversion;
    }
  | {
      readonly kind: "optional-present";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly targetType: MojoTargetTypeRef;
      readonly valueConversion: MojoValueConversion;
    }
  | {
      readonly kind: "optional-to-union";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly targetType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly absentType: Extract<MojoTargetTypeRef, { readonly kind: "null" | "undefined" }>;
      readonly valueConversion: MojoValueConversion;
    }
  | {
      readonly kind: "union-inject";
      readonly targetType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly memberType: MojoTargetTypeRef;
      readonly valueConversion: MojoValueConversion;
    }
  | {
      readonly kind: "union-map";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly targetType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly members: readonly {
        readonly sourceType: MojoTargetTypeRef;
        readonly targetType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
    };
