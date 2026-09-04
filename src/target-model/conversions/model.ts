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
  | {
      readonly kind: "project-view";
      readonly sourceType: MojoTargetTypeRef;
      readonly targetType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "callable-adapt";
      readonly targetType: MojoTargetTypeRef;
      readonly result: "preserve" | "never";
      readonly error: "preserve" | "widen" | "erase";
      readonly sourceErrorType?: MojoTargetTypeRef;
      readonly errorConversion?: MojoValueConversion;
    }
  | { readonly kind: "js-truthiness"; readonly conversion: MojoTruthinessConversion }
  | {
      readonly kind: "js-callback-truthiness";
      readonly targetType: MojoTargetTypeRef;
      readonly source: "number" | "string" | "native-string" | "dynamic" | "always-true" | "always-false";
    }
  | { readonly kind: "primitive-cast"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "reference-copy"; readonly targetType: MojoTargetTypeRef }
  | ({
      readonly kind: "js-box";
      readonly targetType: MojoTargetTypeRef;
    } & (
      | {
          readonly source: "number";
          readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "source-primitive" }>;
        }
      | {
          readonly source: "bool" | "string" | "native-string" | "symbol" | "null" | "undefined";
        }
    ))
  | {
      readonly kind: "js-structural-object-box";
      readonly sourceType: MojoTargetTypeRef;
      readonly targetType: MojoTargetTypeRef;
      readonly fields: readonly {
        readonly sourceName: string;
        readonly storageIndex: number;
        readonly sourceType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
    }
  | {
      readonly kind: "js-sequence-box";
      readonly sourceType: MojoTargetTypeRef;
      readonly targetType: MojoTargetTypeRef;
      readonly source: "js-array";
      readonly elementType: MojoTargetTypeRef;
      readonly elementConversion: MojoValueConversion;
    }
  | {
      readonly kind: "js-tuple-box";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "tuple" | "fixed-array" }>;
      readonly targetType: MojoTargetTypeRef;
      readonly elements: readonly {
        readonly index: number;
        readonly sourceType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
    }
  | {
      readonly kind: "js-optional-box";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly targetType: MojoTargetTypeRef;
      readonly valueConversion: MojoValueConversion;
    }
  | {
      readonly kind: "js-union-box";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly targetType: MojoTargetTypeRef;
      readonly members: readonly {
        readonly sourceType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
    }
  | {
      readonly kind: "js-selected-to-json";
      readonly sourceType: MojoTargetTypeRef;
      readonly targetType: MojoTargetTypeRef;
      readonly declaration: import("@tsonic/tsts").Node;
      readonly methodName: string;
      readonly passesPropertyKey: boolean;
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly sourceCopy: "implicit" | "explicit";
    }
  | { readonly kind: "native-to-js-string"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-to-native-string" }
  | {
      readonly kind: "native-error-result-unwrap";
      readonly sourceType: MojoTargetTypeRef;
      readonly targetType: MojoTargetTypeRef;
    }
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
      readonly kind: "union-to-optional";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly targetType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly presentMembers: readonly {
        readonly sourceType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
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
    }
  | {
      readonly kind: "narrowed-union-map";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly selectedType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly targetType: MojoTargetTypeRef;
      readonly members: readonly {
        readonly sourceType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
    };

export interface MojoValueConversionNarrowing {
  readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
  readonly selectedType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
}
