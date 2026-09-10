import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";

export type MojoProjectConstruction =
  | {
      readonly kind: "initializer";
      readonly type: MojoTargetTypeRef;
    }
  | {
      readonly kind: "factory";
      readonly type: MojoTargetTypeRef;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly genericArguments: readonly MojoTargetGenericArgument[];
    };
