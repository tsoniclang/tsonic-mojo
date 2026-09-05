export type MojoLifecycleTraitRole =
  | "copyable"
  | "implicitly-copyable"
  | "movable"
  | "deinitializable"
  | "register-passable"
  | "trivial-register-passable";

export type MojoCopyCapability = "implicit" | "explicit" | "unavailable";

export type MojoRegisterPassingCapability = "trivial" | "register" | "unavailable";

export interface MojoLifecycleCapabilities {
  readonly copy: MojoCopyCapability;
  readonly movable: boolean;
  readonly deinitializable: boolean;
  readonly registerPassing: MojoRegisterPassingCapability;
  readonly explicitDestruction: boolean;
}

export type MojoNamedLifecycleContract =
  | {
      readonly kind: "fixed";
      readonly capabilities: MojoLifecycleCapabilities;
    }
  | {
      readonly kind: "aggregate";
      readonly genericArgumentIndexes: readonly number[];
      readonly implicitCopyWhenPossible: boolean;
      readonly explicitDestruction: boolean;
    };

export type MojoValueOwnership = "stable" | "fresh" | "borrowed";
