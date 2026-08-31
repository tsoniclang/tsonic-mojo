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
      readonly typeArguments?: readonly MojoTargetTypeRef[];
    }
  | { readonly kind: "list"; readonly element: MojoTargetTypeRef }
  | { readonly kind: "optional"; readonly value: MojoTargetTypeRef }
  | { readonly kind: "tuple"; readonly elements: readonly MojoTargetTypeRef[] };

export type MojoCallArgumentConvention =
  | "immutable-reference"
  | "mutable-reference"
  | "transfer";

export type MojoProviderOperationForm =
  | {
      readonly kind: "function-call";
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly arguments: readonly MojoCallArgumentConvention[];
    }
  | {
      readonly kind: "instance-call";
      readonly name: string;
      readonly receiver: MojoCallArgumentConvention;
      readonly arguments: readonly MojoCallArgumentConvention[];
    }
  | {
      readonly kind: "property-read";
      readonly name: string;
      readonly receiver: MojoCallArgumentConvention;
    }
  | {
      readonly kind: "constant";
      readonly modulePath: readonly string[];
      readonly name: string;
    };
