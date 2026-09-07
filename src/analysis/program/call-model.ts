import type { Node } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import type {
  MojoCallArgumentPosition,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoArgumentDisposition } from "../representations/model.js";

export interface MojoAnalyzedCallArgument {
  readonly expression: Node;
  readonly sourceArgumentIndex: number;
  readonly sourceForm: "value" | "spread-element" | "spread-sequence";
  readonly spreadElementIndex?: number;
  readonly sourceContainerType?: MojoTargetTypeRef;
  readonly sourceType: MojoTargetTypeRef;
  readonly parameterType: MojoTargetTypeRef;
  readonly conversion: MojoValueConversion;
  readonly disposition: MojoArgumentDisposition;
  readonly spread: boolean;
  readonly position: MojoCallArgumentPosition;
  readonly nativeName?: string;
  readonly parameterIndex: number;
  readonly callableConsumption?: "immediate" | "retained";
  readonly locationBorrow?: {
    readonly declaration: Node;
    readonly mutability: "immutable" | "mutable";
  };
}

export type MojoCallableArgumentSlot =
  | { readonly kind: "value"; readonly argument: MojoAnalyzedCallArgument }
  | { readonly kind: "optional-absent"; readonly type: MojoTargetTypeRef }
  | {
      readonly kind: "rest";
      readonly type: MojoTargetTypeRef;
      readonly elementType: MojoTargetTypeRef;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
    };

export type MojoCallSelection =
  | {
      readonly kind: "source-intrinsic";
      readonly operation:
        | "comptime-value"
        | "comptime-type"
        | "comptime-condition"
        | "comptime-iteration"
        | "copy"
        | "materialize"
        | "write-only-reference"
        | "read-write-reference"
        | "read-only-reference"
        | "shared-borrow"
        | "mutable-borrow"
        | "move"
        | "js-string";
      readonly operand?: Node;
      readonly value?: MojoTargetGenericArgument;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "explicit-safety";
      readonly form: "remaining-block";
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "explicit-safety";
      readonly form: "expression";
      readonly expression: Node;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "native-pointer";
      readonly operation: "load";
      readonly pointerExpression: Node;
      readonly pointerType: MojoTargetTypeRef;
      readonly pointeeType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "native-pointer";
      readonly operation: "store";
      readonly pointerExpression: Node;
      readonly pointerType: MojoTargetTypeRef;
      readonly pointeeType: MojoTargetTypeRef;
      readonly valueExpression: Node;
      readonly valueType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "native-pointer";
      readonly operation: "offset";
      readonly pointerExpression: Node;
      readonly pointerType: MojoTargetTypeRef;
      readonly pointeeType: MojoTargetTypeRef;
      readonly offsetExpression: Node;
      readonly offsetType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "raw-pointer";
      readonly operation: "equal";
      readonly leftExpression: Node;
      readonly leftType: MojoTargetTypeRef;
      readonly rightExpression: Node;
      readonly rightType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "raw-pointer";
      readonly operation: "hash";
      readonly pointerExpression: Node;
      readonly pointerType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "address-of";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly storageDeclaration: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "allocate";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly initialExpression: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "load";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly pointerExpression: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "store";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly pointerExpression: Node;
      readonly valueExpression: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "equal-pointer";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly operandType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly leftExpression: Node;
      readonly rightExpression: Node;
    }
  | {
      readonly kind: "project";
      readonly target:
        | {
            readonly kind: "function";
            readonly declaration: Node;
            readonly adapterDeclaration?: Node;
            readonly name: string;
            readonly modulePath: readonly string[];
          }
        | {
            readonly kind: "method";
            readonly name: string;
            readonly declaration: Node;
            readonly adapterDeclaration?: Node;
            readonly implementationDeclaration: Node;
            readonly receiver: Node;
            readonly receiverType: MojoTargetTypeRef;
            readonly dispatch: "virtual" | "exact";
          }
        | {
            readonly kind: "static-method";
            readonly declaration: Node;
            readonly adapterDeclaration?: Node;
            readonly implementationDeclaration: Node;
            readonly owner: MojoTargetTypeRef;
            readonly name: string;
          }
        | {
            readonly kind: "constructor";
            readonly construction: import("./construction-model.js").MojoProjectConstruction;
            readonly adapterDeclaration?: Node;
          };
      readonly genericArguments: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly dynamicDispatchErrorType?: MojoTargetTypeRef;
      readonly invocationErrorType?: MojoTargetTypeRef;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "provider";
      readonly operation: MojoSelectedProviderOperation;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly receiver?: Node;
      readonly sourceReceiverType?: MojoTargetTypeRef;
      readonly receiverConversion?: MojoValueConversion;
      readonly receiverDisposition?: MojoArgumentDisposition;
      readonly propagatedCallbackParameterIndex?: number;
      readonly propagatedCallbackBaseErrorType?: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "callable";
      readonly callee: Node;
      readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly argumentSlots: readonly MojoCallableArgumentSlot[];
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "object-assign";
      readonly target: Node;
      readonly source: Node;
      readonly targetType: MojoTargetTypeRef;
      readonly sourceType: MojoTargetTypeRef;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly fields: readonly {
        readonly sourceName: string;
        readonly sourceStorageIndex: number;
        readonly targetStorageIndex: number;
        readonly sourceType: MojoTargetTypeRef;
        readonly targetType: MojoTargetTypeRef;
        readonly conversion: MojoValueConversion;
      }[];
      readonly resultType: MojoTargetTypeRef;
      readonly optionalChain: false;
    }
  | {
      readonly kind: "json-stringify";
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly replacer: "none" | "callable";
      readonly space: "none" | "number" | "string";
      readonly runtimeResultType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: false;
    };
