import type {
  MojoCallArgumentConvention,
  MojoProviderTargetArgument,
  MojoProviderTargetGenericParameter,
} from "../types/model.js";

export type MojoProviderOperationForm =
  | {
      readonly kind: "function-call";
      readonly modulePath: readonly string[];
      readonly ownerPath?: readonly string[];
      readonly name: string;
      readonly receiver?: MojoCallArgumentConvention;
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
      readonly access:
        | { readonly kind: "member"; readonly name: string }
        | { readonly kind: "method"; readonly name: string };
      readonly receiver: MojoCallArgumentConvention;
    }
  | {
      readonly kind: "property-write";
      readonly access: { readonly kind: "member"; readonly name: string };
      readonly receiver: MojoCallArgumentConvention;
      readonly value: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "index-read";
      readonly access:
        | { readonly kind: "element" }
        | { readonly kind: "method"; readonly name: string };
      readonly receiver: MojoCallArgumentConvention;
      readonly index: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "index-write";
      readonly access: { readonly kind: "element" };
      readonly receiver: MojoCallArgumentConvention;
      readonly index: MojoProviderTargetArgument;
      readonly value: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "constant";
      readonly modulePath: readonly string[];
      readonly name: string;
    };
