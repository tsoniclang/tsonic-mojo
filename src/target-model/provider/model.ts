import type { SourcePrimitiveKind } from "@tsonic/tsts";

export type MojoTargetTypeRef =
  | { readonly kind: "source-primitive"; readonly name: SourcePrimitiveKind }
  | { readonly kind: "native-string" }
  | { readonly kind: "unit" }
  | { readonly kind: "type-parameter"; readonly name: string }
  | {
      readonly kind: "target-named";
      readonly id: string;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly genericArguments?: readonly MojoTargetGenericArgument[];
    }
  | { readonly kind: "list"; readonly element: MojoTargetTypeRef }
  | { readonly kind: "optional"; readonly value: MojoTargetTypeRef }
  | { readonly kind: "tuple"; readonly elements: readonly MojoTargetTypeRef[] }
  | {
      readonly kind: "associated";
      readonly owner: MojoTargetTypeRef;
      readonly memberPath: readonly string[];
      readonly genericArguments: readonly MojoTargetGenericArgument[];
    }
  | { readonly kind: "reference"; readonly origin: string; readonly value: MojoTargetTypeRef }
  | {
      readonly kind: "function";
      readonly parameters: readonly MojoTargetTypeRef[];
      readonly result: MojoTargetTypeRef;
      readonly thin: boolean;
      readonly raises: boolean;
    };

export type MojoTargetGenericArgument =
  | { readonly kind: "type"; readonly name?: string; readonly type: MojoTargetTypeRef }
  | { readonly kind: "type-expression"; readonly name?: string; readonly expression: string }
  | { readonly kind: "value"; readonly name?: string; readonly expression: string }
  | { readonly kind: "unbound"; readonly name?: string };

export type MojoCallArgumentConvention =
  | "imm"
  | "mut"
  | "var"
  | "ref"
  | "out"
  | "deinit";

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
}

export interface MojoTargetConformanceCondition {
  readonly kind: "conforms-to";
  readonly parameterName: string;
  readonly traitNames: readonly string[];
}

export type MojoProviderOperationForm =
  | {
      readonly kind: "function-call";
      readonly modulePath: readonly string[];
      readonly ownerPath?: readonly string[];
      readonly name: string;
      readonly genericParameters?: readonly MojoProviderTargetGenericParameter[];
      readonly arguments: readonly MojoProviderTargetArgument[];
    }
  | {
      readonly kind: "instance-call";
      readonly name: string;
      readonly receiver: MojoCallArgumentConvention;
      readonly genericParameters?: readonly MojoProviderTargetGenericParameter[];
      readonly arguments: readonly MojoProviderTargetArgument[];
    }
  | {
      readonly kind: "property-read";
      readonly name: string;
      readonly receiver: MojoCallArgumentConvention;
    }
  | {
      readonly kind: "property-write";
      readonly name: string;
      readonly receiver: MojoCallArgumentConvention;
      readonly value: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "constant";
      readonly modulePath: readonly string[];
      readonly name: string;
    };
