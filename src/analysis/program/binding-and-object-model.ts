import type { Node } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedInterfaceIndexSignature,
  MojoAnalyzedParameter,
} from "./model.js";

export interface MojoCallableCapture {
  readonly declaration: Node;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly storage: "value" | "location";
}

export interface MojoRecursiveCallableBinding {
  readonly declaration: Node;
  readonly name: string;
  readonly type: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
}

export interface MojoCallableExpressionSelection {
  readonly expression: Node;
  readonly sourceFile: import("@tsonic/tsts").SourceFile;
  readonly kind: import("./model.js").MojoAnalyzedCallableKind;
  readonly typeParameters: readonly import("./model.js").MojoAnalyzedTypeParameter[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly captures: readonly MojoCallableCapture[];
  readonly recursiveBinding?: MojoRecursiveCallableBinding;
  readonly resultType: MojoTargetTypeRef;
  readonly body: Node;
  readonly asynchronous: boolean;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly owner?: import("./model.js").MojoAnalyzedClassOwner;
  readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
}

export type MojoTemplateStringConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "native-to-js" }
  | { readonly kind: "js-to-native" }
  | { readonly kind: "boolean" }
  | { readonly kind: "number" }
  | { readonly kind: "integer" }
  | { readonly kind: "character" }
  | { readonly kind: "native-error" }
  | { readonly kind: "js-dynamic" }
  | { readonly kind: "null" }
  | { readonly kind: "undefined" }
  | {
      readonly kind: "optional";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly value: MojoTemplateStringConversion;
    }
  | {
      readonly kind: "union";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly members: readonly {
        readonly type: MojoTargetTypeRef;
        readonly conversion: MojoTemplateStringConversion;
      }[];
    };

export interface MojoTemplateExpressionSelection {
  readonly expression: Node;
  readonly resultType: MojoTargetTypeRef;
  readonly substitutions: readonly {
    readonly expression: Node;
    readonly type: MojoTargetTypeRef;
    readonly conversion: MojoTemplateStringConversion;
  }[];
}

export type MojoBindingValueProjection =
  | { readonly kind: "element"; readonly index: number }
  | { readonly kind: "list-element"; readonly index: number; readonly checked: boolean }
  | { readonly kind: "project-field"; readonly name: string }
  | { readonly kind: "structural-field"; readonly storageIndex: number }
  | { readonly kind: "dictionary-key"; readonly key: string };

export type MojoBindingProjection =
  | MojoBindingValueProjection
  | { readonly kind: "tuple-rest"; readonly start: number }
  | { readonly kind: "fixed-array-rest"; readonly start: number }
  | { readonly kind: "list-rest"; readonly start: number }
  | {
      readonly kind: "object-rest";
      readonly fields: readonly {
        readonly source: MojoBindingValueProjection;
        readonly sourceType: MojoTargetTypeRef;
        readonly targetStorageIndex: number;
      }[];
    };

export type MojoBindingNormalization = "identity" | "default-on-none";

export interface MojoBindingPatternElementSelection {
  readonly element: Node;
  readonly projection: MojoBindingProjection;
  readonly projectedType: MojoTargetTypeRef;
  readonly normalization: MojoBindingNormalization;
  readonly initializer?: Node;
  readonly target:
    | {
        readonly kind: "binding";
        readonly declaration: Node;
        readonly name: string;
        readonly type: MojoTargetTypeRef;
      }
    | {
        readonly kind: "pattern";
        readonly pattern: Node;
        readonly type: MojoTargetTypeRef;
        readonly elements: readonly MojoBindingPatternElementSelection[];
      };
}

export interface MojoBindingPatternSelection {
  readonly declaration: Node;
  readonly initializer: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly sourceReuse: "direct" | "stabilized";
  readonly elements: readonly MojoBindingPatternElementSelection[];
}

export type MojoObjectLiteralContribution =
  | {
      readonly kind: "field";
      readonly element: Node;
      readonly value: Node;
      readonly field: MojoAnalyzedInterfaceField | import("./model.js").MojoAnalyzedAccessorProperty;
      readonly fieldType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "spread";
      readonly element: Node;
      readonly value: Node;
      readonly sourceType: MojoTargetTypeRef;
      readonly fields: readonly {
        readonly field: MojoAnalyzedInterfaceField;
        readonly fieldType: MojoTargetTypeRef;
      }[];
      readonly indexSignatures: readonly {
        readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
        readonly keyType: MojoTargetTypeRef;
        readonly valueType: MojoTargetTypeRef;
      }[];
    }
  | {
      readonly kind: "index-entry";
      readonly element: Node;
      readonly value: Node;
      readonly key:
        | { readonly kind: "literal"; readonly value: string; readonly literalKind: "string" | "number" }
        | { readonly kind: "expression"; readonly expression: Node };
      readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
      readonly keyType: MojoTargetTypeRef;
      readonly valueType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "method";
      readonly element: Node;
      readonly contractDeclarations: readonly Node[];
    }
  | {
      readonly kind: "getter";
      readonly element: Node;
      readonly contractDeclarations: readonly Node[];
    }
  | {
      readonly kind: "setter";
      readonly element: Node;
      readonly contractDeclarations: readonly Node[];
    };

export type MojoObjectLiteralSelection =
  | {
      readonly kind: "interface";
      readonly interface: MojoAnalyzedInterface;
      readonly constructionType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly fields: readonly {
        readonly field: MojoAnalyzedInterfaceField;
        readonly fieldType: MojoTargetTypeRef;
      }[];
      readonly indexSignatures: readonly {
        readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
        readonly keyType: MojoTargetTypeRef;
        readonly valueType: MojoTargetTypeRef;
      }[];
      readonly contributions: readonly MojoObjectLiteralContribution[];
    }
  | {
      readonly kind: "provider-record";
      readonly targetType: MojoTargetTypeRef;
      readonly fields: readonly {
        readonly element: Node;
        readonly value: Node;
        readonly providerMemberId: string;
        readonly targetName: string;
        readonly storageType: MojoTargetTypeRef;
      }[];
    };
