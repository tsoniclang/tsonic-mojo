import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoLifecycleCapabilities,
  MojoValueOwnership,
} from "../../target-model/lifecycle/model.js";

export interface MojoLifecycleResolver {
  capabilities(type: MojoTargetTypeRef): MojoLifecycleCapabilities;
}

export interface MojoLifecycleCatalog extends MojoLifecycleResolver {
  readonly entries: readonly {
    readonly type: MojoTargetTypeRef;
    readonly capabilities: MojoLifecycleCapabilities;
  }[];
}

export interface MojoLifecycleAnalysis extends MojoLifecycleResolver {
  seal(types: readonly MojoTargetTypeRef[]): MojoLifecycleCatalog;
}

export interface MojoValueOwnershipCatalog {
  get(expression: import("@tsonic/tsts").Node): MojoValueOwnership | undefined;
}
