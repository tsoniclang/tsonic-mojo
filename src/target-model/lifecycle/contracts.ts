import type {
  MojoLifecycleCapabilities,
  MojoLifecycleTraitRole,
  MojoNamedLifecycleContract,
} from "./model.js";
import type { MojoTargetTypeRef } from "../types/model.js";

export const mojoImplicitHeapLifecycleCapabilities: MojoLifecycleCapabilities = Object.freeze({
  copy: "implicit",
  movable: true,
  deinitializable: true,
  registerPassing: "unavailable",
  explicitDestruction: false,
});

export const mojoExplicitLifecycleCapabilities: MojoLifecycleCapabilities = Object.freeze({
  copy: "explicit",
  movable: true,
  deinitializable: true,
  registerPassing: "unavailable",
  explicitDestruction: false,
});

export function fixedMojoLifecycleContract(
  capabilities: MojoLifecycleCapabilities,
): MojoNamedLifecycleContract {
  return Object.freeze({ kind: "fixed", capabilities });
}

export function aggregateMojoLifecycleContract(
  genericArgumentIndexes: readonly number[],
  options: {
    readonly implicitCopyWhenPossible: boolean;
    readonly explicitDestruction?: boolean;
  },
): MojoNamedLifecycleContract {
  return Object.freeze({
    kind: "aggregate",
    genericArgumentIndexes: Object.freeze([...genericArgumentIndexes]),
    implicitCopyWhenPossible: options.implicitCopyWhenPossible,
    explicitDestruction: options.explicitDestruction === true,
  });
}

const lifecycleTraits: Readonly<Record<MojoLifecycleTraitRole, {
  readonly id: string;
  readonly name: string;
}>> = Object.freeze({
  copyable: Object.freeze({ id: "mojo.builtin.Copyable", name: "Copyable" }),
  "implicitly-copyable": Object.freeze({
    id: "mojo.builtin.ImplicitlyCopyable",
    name: "ImplicitlyCopyable",
  }),
  movable: Object.freeze({ id: "mojo.builtin.Movable", name: "Movable" }),
  deinitializable: Object.freeze({ id: "mojo.builtin.Deinitable", name: "Deinitable" }),
  "register-passable": Object.freeze({
    id: "mojo.builtin.RegisterPassable",
    name: "RegisterPassable",
  }),
  "trivial-register-passable": Object.freeze({
    id: "mojo.builtin.TrivialRegisterPassable",
    name: "TrivialRegisterPassable",
  }),
});

export function mojoLifecycleTraitTargetType(
  role: MojoLifecycleTraitRole,
): MojoTargetTypeRef {
  const trait = lifecycleTraits[role];
  return Object.freeze({
    kind: "target-named",
    id: trait.id,
    modulePath: Object.freeze([]),
    name: trait.name,
    lifecycleRequirement: role,
  });
}
