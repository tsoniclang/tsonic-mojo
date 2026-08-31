import type { TargetRuntimeReference } from "@tsonic/target-api/artifacts";
import {
  mojoPackageNameAttribute,
  mojoPackagePathReferenceKind,
} from "../../target-model/project/runtime-reference.js";
import type { MojoRuntimePackagePlan } from "../program/model.js";

export function analyzeMojoRuntimePackages(
  references: readonly TargetRuntimeReference[],
): readonly MojoRuntimePackagePlan[] {
  const packages = new Map<string, string>();
  for (const reference of references) {
    if (reference.kind !== mojoPackagePathReferenceKind) continue;
    const name = reference.attributes?.[mojoPackageNameAttribute];
    if (name === undefined || name.length === 0 || reference.include.length === 0) {
      throw new Error("Mojo package runtime reference is missing its exact package name or path.");
    }
    const existing = packages.get(name);
    if (existing !== undefined && existing !== reference.include) {
      throw new Error(
        `Mojo runtime package '${name}' has conflicting paths '${existing}' and '${reference.include}'.`,
      );
    }
    packages.set(name, reference.include);
  }
  return Object.freeze([...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([packageName, packagePath]) => Object.freeze({ packageName, packagePath })));
}
