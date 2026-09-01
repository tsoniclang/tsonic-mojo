import type { Node } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import type {
  MojoCallArgumentPosition,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";

export interface MojoAnalyzedCallArgument {
  readonly expression: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly parameterType: MojoTargetTypeRef;
  readonly conversion: MojoValueConversion;
  readonly passing: "plain" | "consume";
  readonly spread: boolean;
  readonly position: MojoCallArgumentPosition;
  readonly nativeName?: string;
  readonly parameterIndex: number;
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
      readonly operation: "bind";
      readonly identityExpression: Node;
      readonly identityType: MojoTargetTypeRef;
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
      readonly resultType: MojoTargetTypeRef;
      readonly leftExpression: Node;
      readonly rightExpression: Node;
    }
  | {
      readonly kind: "project";
      readonly target:
        | { readonly kind: "function"; readonly name: string; readonly modulePath: readonly string[] }
        | {
            readonly kind: "method";
            readonly name: string;
            readonly receiver: Node;
            readonly receiverType: MojoTargetTypeRef;
          }
        | { readonly kind: "static-method"; readonly owner: MojoTargetTypeRef; readonly name: string }
        | { readonly kind: "constructor"; readonly type: MojoTargetTypeRef };
      readonly genericArguments: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "provider";
      readonly operation: MojoSelectedProviderOperation;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly receiver?: Node;
      readonly sourceReceiverType?: MojoTargetTypeRef;
      readonly receiverConversion?: MojoValueConversion;
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
    };
