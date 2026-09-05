import type { Node } from "@tsonic/tsts";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoValueRefinementSelection } from "../refinements/model.js";
import type { MojoParameterDisposition } from "../representations/model.js";
import type { MojoBindingProjectionPlan } from "./binding-and-object-model.js";
import type { MojoAnalyzedModuleBinding } from "./module-model.js";

export type MojoPropertySelection =
  | {
      readonly kind: "project-method";
      readonly declaration: Node;
      readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef;
      readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-field";
      readonly declaration: Node;
      readonly receiver: Node;
      readonly fieldName: string;
      readonly fieldType: MojoTargetTypeRef;
      readonly receiverType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-index-property";
      readonly declaration: Node;
      readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef;
      readonly storageName: string;
      readonly key: string;
      readonly keyType: MojoTargetTypeRef;
      readonly fieldType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-accessor";
      readonly declarations: readonly Node[];
      readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef;
      readonly readName?: string;
      readonly readType?: MojoTargetTypeRef;
      readonly writeName?: string;
      readonly writeType?: MojoTargetTypeRef;
      readonly writeDisposition?: MojoParameterDisposition;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "structural-field";
      readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef;
      readonly storageIndex: number;
      readonly fieldType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-union-field";
      readonly receiver: Node;
      readonly receiverType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly fields: readonly {
        readonly receiverType: MojoTargetTypeRef;
        readonly fieldName: string;
        readonly fieldType: MojoTargetTypeRef;
      }[];
      readonly resultType: MojoTargetTypeRef;
      readonly accessMode: "read";
    }
  | {
      readonly kind: "project-static-field";
      readonly binding: MojoAnalyzedModuleBinding;
      readonly fieldName: string;
      readonly fieldType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-enum-member";
      readonly owner: MojoTargetTypeRef;
      readonly name: string;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "provider";
      readonly readOperation?: MojoSelectedProviderOperation;
      readonly writeOperation?: MojoSelectedProviderOperation;
      readonly receiver: Node;
      readonly sourceReceiverType: MojoTargetTypeRef;
      readonly receiverConversion?: MojoValueConversion;
      readonly readResultConversion?: MojoValueConversion;
      readonly sourceWriteType?: MojoTargetTypeRef;
      readonly targetWriteType?: MojoTargetTypeRef;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "provider-constant";
      readonly operation: MojoSelectedProviderOperation;
      readonly readResultConversion: MojoValueConversion;
    }
  | {
      readonly kind: "provider-static";
      readonly readOperation?: MojoSelectedProviderOperation;
      readonly writeOperation?: MojoSelectedProviderOperation;
      readonly readResultConversion?: MojoValueConversion;
      readonly sourceWriteType?: MojoTargetTypeRef;
      readonly targetWriteType?: MojoTargetTypeRef;
    };

export interface MojoValueSelection {
  readonly kind: "provider-constant";
  readonly operation: MojoSelectedProviderOperation;
  readonly resultConversion: MojoValueConversion;
}

export type MojoIntrinsicExpressionSelection =
  | {
      readonly kind: "numeric";
      readonly operand: Node;
      readonly right?: Node;
      readonly operation: import("../../target-model/operations/numeric.js").MojoNumericOperation;
      readonly writeConversion?: import("../../target-model/operations/numeric.js").MojoNumericConversion;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "typeof";
      readonly operand: Node;
      readonly result:
        | "undefined"
        | "object"
        | "boolean"
        | "number"
        | "bigint"
        | "string"
        | "symbol"
        | "function";
      readonly resultType: Extract<MojoTargetTypeRef, { readonly kind: "native-string" }>;
    }
  | {
      readonly kind: "void";
      readonly operand: Node;
      readonly resultType: Extract<MojoTargetTypeRef, { readonly kind: "undefined" }>;
    };

export type MojoTypeTestSelection =
  | {
      readonly kind: "nullish-comparison";
      readonly left: Node;
      readonly right: Node;
      readonly outcome:
        | { readonly kind: "constant"; readonly value: boolean }
        | {
            readonly kind: "optional-absence";
            readonly operand: "left" | "right";
            readonly equal: boolean;
          }
        | {
            readonly kind: "union-membership";
            readonly operand: "left" | "right";
            readonly testedTypes: readonly Extract<MojoTargetTypeRef, {
              readonly kind: "null" | "undefined";
            }>[];
            readonly equal: boolean;
          };
    }
  | {
      readonly kind: "constant";
      readonly value: boolean;
      readonly operand: Node;
    }
  | {
      readonly kind: "optional-presence";
      readonly operand: Node;
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
    }
  | {
      readonly kind: "union-member";
      readonly operand: Node;
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly testedType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "project-dispatch";
      readonly operand: Node;
      readonly sourceType: MojoTargetTypeRef;
      readonly dispatchType: MojoTargetTypeRef;
      readonly testedType: MojoTargetTypeRef;
    };

export type MojoNullishCoalescingSelection =
  | {
      readonly kind: "left";
      readonly left: Node;
      readonly resultType: MojoTargetTypeRef;
      readonly conversion: MojoValueConversion;
    }
  | {
      readonly kind: "right";
      readonly left: Node;
      readonly right: Node;
      readonly resultType: MojoTargetTypeRef;
      readonly conversion: MojoValueConversion;
    }
  | {
      readonly kind: "optional" | "union";
      readonly left: Node;
      readonly right: Node;
      readonly leftType: MojoTargetTypeRef;
      readonly presentType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly presentConversion: MojoValueConversion;
      readonly rightConversion: MojoValueConversion;
      readonly presentRefinement?: MojoValueRefinementSelection;
    };

export type MojoElementSelection = {
  readonly kind: "native";
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "read" | "write" | "read-write";
  readonly receiverType: MojoTargetTypeRef;
  readonly indexType: MojoTargetTypeRef;
  readonly readType?: MojoTargetTypeRef;
  readonly writeType?: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly readResultConversion?: MojoValueConversion;
  readonly selectedElementIndex?: number;
  readonly evaluateSelectedIndex?: boolean;
  readonly sourceIndexType?: MojoTargetTypeRef;
  readonly optionalChain: boolean;
} | {
  readonly kind: "project-index";
  readonly declaration: Node;
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "read" | "write" | "read-write";
  readonly receiverType: MojoTargetTypeRef;
  readonly storageName: string;
  readonly indexType: MojoTargetTypeRef;
  readonly readType?: MojoTargetTypeRef;
  readonly writeType?: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly readResultConversion?: MojoValueConversion;
  readonly optionalChain: boolean;
} | {
  readonly kind: "provider";
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "read" | "write" | "read-write";
  readonly readOperation?: MojoSelectedProviderOperation;
  readonly writeOperation?: MojoSelectedProviderOperation;
  readonly receiverConversion: MojoValueConversion;
  readonly sourceReceiverType: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly readType?: MojoTargetTypeRef;
  readonly writeType?: MojoTargetTypeRef;
  readonly sourceWriteType?: MojoTargetTypeRef;
  readonly targetWriteType?: MojoTargetTypeRef;
  readonly readResultConversion?: MojoValueConversion;
  readonly optionalChain: boolean;
} | {
  readonly kind: "js-array-delete";
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "delete";
  readonly receiverType: MojoTargetTypeRef;
  readonly indexType: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly resultType: MojoTargetTypeRef;
  readonly readType?: undefined;
  readonly writeType?: undefined;
  readonly readResultConversion?: undefined;
  readonly optionalChain: false;
};

interface MojoIterationSelectionBase {
  readonly statement: Node;
  readonly iterable: Node;
  readonly binding:
    | {
        readonly kind: "identifier";
        readonly declaration: Node;
        readonly name: string;
      }
    | {
      readonly kind: "pattern";
      readonly declaration: Node;
      readonly name: string;
      readonly projection: MojoBindingProjectionPlan;
      };
  readonly iterableType: MojoTargetTypeRef;
  readonly elementType: MojoTargetTypeRef;
}

type MojoValueIterationTarget =
  | "native-values"
  | "js-array-values"
  | "js-map-entries"
  | "js-set-values"
  | "js-string-values";

export type MojoIterationSelection =
  | MojoIterationSelectionBase & {
      readonly kind: "for-in";
      readonly adaptation: "none";
      readonly target: "dictionary-keys";
    }
  | MojoIterationSelectionBase & {
      readonly kind: "for-of";
      readonly adaptation: "none";
      readonly target: MojoValueIterationTarget;
    }
  | MojoIterationSelectionBase & {
      readonly kind: "for-await-of";
      readonly adaptation: "synchronous-to-async";
      readonly target: MojoValueIterationTarget;
    };

export type MojoResourceDisposalSelection =
  | {
      readonly kind: "project";
      readonly name: string;
      readonly asynchronous: boolean;
      readonly raises: boolean;
      readonly dependency: Node;
    }
  | {
      readonly kind: "provider";
      readonly identity: string;
      readonly operation: MojoSelectedProviderOperation;
      readonly asynchronous: boolean;
    };

export interface MojoResourceDisposalAlternative {
  readonly resourceType: MojoTargetTypeRef;
  readonly disposal: MojoResourceDisposalSelection;
}

export interface MojoResourceManagementSelection {
  readonly declaration: Node;
  readonly declarationKind: "using" | "await using";
  readonly bindingName: string;
  readonly storageType: MojoTargetTypeRef;
  readonly resourceType: MojoTargetTypeRef;
  readonly storageMode: "direct" | "optional" | "nullish-union";
  readonly alternatives: readonly MojoResourceDisposalAlternative[];
}
