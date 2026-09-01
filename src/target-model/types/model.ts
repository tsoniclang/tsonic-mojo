import type { SourcePrimitiveKind } from "@tsonic/tsts";

export type MojoTargetTypeRef =
  | { readonly kind: "source-primitive"; readonly name: SourcePrimitiveKind }
  | { readonly kind: "native-string" }
  | { readonly kind: "unit" }
  | { readonly kind: "never" }
  | { readonly kind: "null" }
  | { readonly kind: "undefined" }
  | { readonly kind: "dynamic"; readonly domain: "source" | "js" }
  | { readonly kind: "bigint" }
  | { readonly kind: "symbol" }
  | { readonly kind: "type-parameter"; readonly name: string }
  | {
      readonly kind: "target-named";
      readonly id: string;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly genericArguments?: readonly MojoTargetGenericArgument[];
    }
  | { readonly kind: "list"; readonly element: MojoTargetTypeRef }
  | {
      readonly kind: "fixed-array";
      readonly element: MojoTargetTypeRef;
      readonly length: MojoTargetConstArgument;
    }
  | {
      readonly kind: "dictionary";
      readonly key: MojoTargetTypeRef;
      readonly value: MojoTargetTypeRef;
    }
  | {
      readonly kind: "future";
      readonly domain: "native" | "js";
      readonly output: MojoTargetTypeRef;
    }
  | { readonly kind: "optional"; readonly value: MojoTargetTypeRef }
  | { readonly kind: "union"; readonly members: readonly MojoTargetTypeRef[] }
  | { readonly kind: "tuple"; readonly elements: readonly MojoTargetTypeRef[] }
  | {
      readonly kind: "associated";
      readonly owner: MojoTargetTypeRef;
      readonly memberPath: readonly string[];
      readonly genericArguments: readonly MojoTargetGenericArgument[];
    }
  | { readonly kind: "compiler-expression"; readonly expression: string }
  | { readonly kind: "reference"; readonly origin: string; readonly value: MojoTargetTypeRef }
  | {
      readonly kind: "callable";
      readonly parameters: readonly MojoTargetCallableParameter[];
      readonly result: MojoTargetTypeRef;
      readonly raises: boolean;
    }
  | {
      readonly kind: "function";
      readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
      readonly parameters: readonly MojoTargetCallableParameter[];
      readonly result: MojoTargetTypeRef;
      readonly asynchronous: boolean;
      readonly thin: boolean;
      readonly raises: boolean;
      readonly errorType?: MojoTargetTypeRef;
      readonly capture?: string;
    };

export type MojoTargetConstArgument =
  | { readonly kind: "integer"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "parameter"; readonly name: string };

export type MojoTargetGenericArgument =
  | { readonly kind: "type"; readonly name?: string; readonly type: MojoTargetTypeRef }
  | { readonly kind: "type-expression"; readonly name?: string; readonly expression: string }
  | { readonly kind: "compiler-expression"; readonly name?: string; readonly expression: string }
  | { readonly kind: "static-string"; readonly name?: string; readonly value: string }
  | { readonly kind: "integer"; readonly name?: string; readonly value: string }
  | { readonly kind: "boolean"; readonly name?: string; readonly value: boolean }
  | { readonly kind: "value-reference"; readonly name?: string; readonly path: readonly string[] }
  | { readonly kind: "unbound"; readonly name?: string };

export type MojoCallArgumentConvention =
  | "imm"
  | "mut"
  | "var"
  | "ref"
  | "out"
  | "deinit";

export interface MojoTargetCallableParameter {
  readonly name?: string;
  readonly convention: MojoCallArgumentConvention;
  readonly passing: "plain" | "consume";
  readonly type: MojoTargetTypeRef;
}

export type MojoCallArgumentPosition =
  | "positional"
  | "positional-or-keyword"
  | "keyword";

export interface MojoProviderTargetArgument {
  readonly convention: MojoCallArgumentConvention;
  readonly position: MojoCallArgumentPosition;
  readonly nativeName?: string;
  readonly variadic?: boolean;
}

export interface MojoProviderTargetGenericParameter {
  readonly kind: "type" | "value" | "origin";
  readonly name: string;
  readonly position: "positional" | "positional-or-keyword" | "keyword" | "inferred";
  readonly variadic: boolean;
  readonly constraints: readonly MojoTargetTypeRef[];
  readonly defaultArgument?: MojoTargetGenericArgument;
}

export type MojoTargetConformanceCondition =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "conforms-to"; readonly subject: string; readonly traitNames: readonly string[] }
  | { readonly kind: "predicate"; readonly value: MojoTargetConditionValue }
  | {
      readonly kind: "equals";
      readonly left: MojoTargetConditionValue;
      readonly right: MojoTargetConditionValue;
    }
  | { readonly kind: "not"; readonly operand: MojoTargetConformanceCondition }
  | { readonly kind: "all" | "any"; readonly operands: readonly MojoTargetConformanceCondition[] }
  | {
      readonly kind: "conditional";
      readonly condition: MojoTargetConformanceCondition;
      readonly whenTrue: MojoTargetConformanceCondition;
      readonly whenFalse: MojoTargetConformanceCondition;
    };

export type MojoTargetConditionValue =
  | { readonly kind: "path"; readonly segments: readonly string[] }
  | {
      readonly kind: "generic-call";
      readonly receiver: readonly string[];
      readonly typeArguments: readonly string[];
    };
