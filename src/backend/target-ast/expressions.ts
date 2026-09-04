import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoParameter } from "./declarations.js";

export type MojoExpression =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "qualified-path"; readonly segments: readonly string[] }
  | { readonly kind: "type-value"; readonly type: MojoTargetTypeRef }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "number-literal"; readonly text: string }
  | { readonly kind: "bool-literal"; readonly value: boolean }
  | { readonly kind: "none-literal" }
  | { readonly kind: "tuple"; readonly elements: readonly MojoExpression[] }
  | { readonly kind: "list"; readonly elements: readonly MojoExpression[] }
  | { readonly kind: "dictionary"; readonly entries: readonly MojoDictionaryEntry[] }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: MojoExpression }
  | {
      readonly kind: "binary";
      readonly operator: string;
      readonly left: MojoExpression;
      readonly right: MojoExpression;
    }
  | {
      readonly kind: "conditional";
      readonly condition: MojoExpression;
      readonly whenTrue: MojoExpression;
      readonly whenFalse: MojoExpression;
    }
  | {
      readonly kind: "call";
      readonly callee: MojoExpression;
      readonly genericArguments?: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoCallArgument[];
    }
  | {
      readonly kind: "method-call";
      readonly receiver: MojoExpression;
      readonly name: string;
      readonly genericArguments?: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoCallArgument[];
    }
  | { readonly kind: "member"; readonly receiver: MojoExpression; readonly name: string }
  | { readonly kind: "element"; readonly receiver: MojoExpression; readonly index: MojoExpression }
  | {
      readonly kind: "type-element";
      readonly receiver: MojoExpression;
      readonly type: MojoTargetTypeRef;
    }
  | {
      readonly kind: "slice";
      readonly receiver: MojoExpression;
      readonly start?: MojoExpression;
      readonly end?: MojoExpression;
      readonly step?: MojoExpression;
    }
  | {
      readonly kind: "construct";
      readonly type: MojoTargetTypeRef;
      readonly genericArguments?: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoCallArgument[];
    }
  | { readonly kind: "forced-comptime"; readonly expression: MojoExpression }
  | { readonly kind: "generic-argument-value"; readonly value: MojoTargetGenericArgument }
  | { readonly kind: "copy"; readonly expression: MojoExpression }
  | { readonly kind: "materialize"; readonly expression: MojoExpression }
  | { readonly kind: "consume"; readonly expression: MojoExpression }
  | { readonly kind: "postfix-deref"; readonly expression: MojoExpression }
  | { readonly kind: "await"; readonly expression: MojoExpression }
  | { readonly kind: "parenthesized"; readonly expression: MojoExpression }
  | {
      readonly kind: "lambda";
      readonly parameters: readonly MojoParameter[];
      readonly captures: readonly MojoLambdaCapture[];
      readonly resultType: MojoTargetTypeRef;
      readonly raises: boolean;
      readonly errorType?: MojoTargetTypeRef;
      readonly expression: MojoExpression;
    };

export interface MojoLambdaCapture {
  readonly name: string;
  readonly convention: "imm" | "mut" | "var" | "ref";
  readonly transfer?: boolean;
}

export interface MojoDictionaryEntry {
  readonly key: MojoExpression;
  readonly value: MojoExpression;
}

export interface MojoCallArgument {
  readonly value: MojoExpression;
  readonly name?: string;
  readonly spread?: boolean;
}
