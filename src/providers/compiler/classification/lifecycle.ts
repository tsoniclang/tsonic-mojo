import type { MojoLifecycleTraitRole } from "../../../target-model/lifecycle/model.js";

const lifecycleRoleByCompilerPath: ReadonlyMap<string, MojoLifecycleTraitRole> = new Map([
  ["/std/traits/copyable/Copyable", "copyable"],
  ["/std/traits/copyable/ImplicitlyCopyable", "implicitly-copyable"],
  ["/std/traits/movable/Movable", "movable"],
  ["/std/traits/deinitable/Deinitable", "deinitializable"],
  ["/std/builtin/value/RegisterPassable", "register-passable"],
  ["/std/builtin/value/TrivialRegisterPassable", "trivial-register-passable"],
]);

const implicitConformancePaths = new Set([
  "/std/traits/anytype/AnyType",
  "/std/traits/deinitable/Deinitable",
  "/std/traits/movable/Movable",
]);

export function mojoLifecycleRoleForCompilerPath(
  path: string | undefined,
): MojoLifecycleTraitRole | undefined {
  return path === undefined ? undefined : lifecycleRoleByCompilerPath.get(path);
}

export function isImplicitMojoConformancePath(path: string | undefined): boolean {
  return path !== undefined && implicitConformancePaths.has(path);
}
