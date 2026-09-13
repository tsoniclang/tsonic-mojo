import type {
  MojoCallArgumentConvention,
  MojoProviderTargetArgument,
  MojoProviderTargetGenericParameter,
} from "../types/model.js";

export type MojoProviderOperationForm =
  | {
      readonly kind: "foreign-call";
      readonly symbol: string;
      readonly fixedParameterCount: number;
      readonly arguments: readonly MojoProviderTargetArgument[];
      readonly receiver?: never;
    }
  | {
      readonly kind: "value-predicate";
      readonly predicate: import("./value-predicate.js").MojoNativeValuePredicate;
      readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
      readonly arguments: readonly MojoProviderTargetArgument[];
      readonly receiver?: never;
    }
  | {
      readonly kind: "unsupported";
      readonly code: string;
      readonly reason: string;
    }
  | {
      readonly kind: "function-call";
      readonly sourceModule?: import("./source-module.js").MojoSourceModuleArgument;
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
        | { readonly kind: "method"; readonly name: string }
        | {
            readonly kind: "function";
            readonly modulePath: readonly string[];
            readonly name: string;
          };
      readonly receiver: MojoCallArgumentConvention;
    }
  | {
      readonly kind: "property-write";
      readonly access:
        | { readonly kind: "member"; readonly name: string }
        | { readonly kind: "method"; readonly name: string };
      readonly receiver: MojoCallArgumentConvention;
      readonly value: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "index-read";
      readonly access:
        | { readonly kind: "element" }
        | { readonly kind: "method"; readonly name: string }
        | {
            readonly kind: "function";
            readonly modulePath: readonly string[];
            readonly name: string;
          };
      readonly receiver: MojoCallArgumentConvention;
      readonly index: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "index-write";
      readonly access:
        | { readonly kind: "element" }
        | { readonly kind: "method"; readonly name: string };
      readonly receiver: MojoCallArgumentConvention;
      readonly index: MojoProviderTargetArgument;
      readonly value: MojoProviderTargetArgument;
    }
  | {
      readonly kind: "constant";
      readonly modulePath: readonly string[];
      readonly name: string;
    }
  | {
      readonly kind: "function-read";
      readonly modulePath: readonly string[];
      readonly name: string;
    }
  | {
      readonly kind: "function-write";
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly value: MojoProviderTargetArgument;
    };
