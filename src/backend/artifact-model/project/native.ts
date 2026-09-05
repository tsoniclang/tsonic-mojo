import type { MojoRuntimePackagePlan } from "../../../analysis/program/model.js";
import type {
  MojoRuntimeEnvironmentDependency,
} from "../../../analysis/runtime/native-package.js";

export interface MojoNativeBuildPlan {
  readonly dependencies: readonly MojoRuntimeEnvironmentDependency[];
  readonly packages: readonly MojoNativeBuildPackage[];
  readonly staticLibraries: readonly string[];
  readonly dynamicLibraries: readonly string[];
}

export interface MojoNativeBuildPackage {
  readonly packageName: string;
  readonly digest: string;
  readonly includeDirectories: readonly string[];
  readonly translationUnits: readonly MojoNativeBuildTranslationUnit[];
}

export interface MojoNativeBuildTranslationUnit {
  readonly sourcePath: string;
  readonly objectPath: string;
  readonly standard: "c11";
}

export function createMojoNativeBuildPlan(
  runtimePackages: readonly MojoRuntimePackagePlan[],
): MojoNativeBuildPlan {
  const dependencies = new Map<string, string>();
  const staticLibraries = new Set<string>();
  const dynamicLibraries = new Set<string>();
  const packages: MojoNativeBuildPackage[] = [];
  for (const runtime of runtimePackages) {
    const native = runtime.native;
    if (native === undefined) continue;
    for (const dependency of native.dependencies) {
      const existing = dependencies.get(dependency.name);
      if (existing !== undefined && existing !== dependency.version) {
        throw new Error(
          `Mojo runtime dependency '${dependency.name}' requires both '${existing}' and '${dependency.version}'.`,
        );
      }
      dependencies.set(dependency.name, dependency.version);
    }
    for (const path of native.staticLibraries) staticLibraries.add(path);
    for (const name of native.dynamicLibraries) dynamicLibraries.add(name);
    packages.push(Object.freeze({
      packageName: runtime.packageName,
      digest: native.digest,
      includeDirectories: native.includeDirectories,
      translationUnits: Object.freeze(native.translationUnits.map((unit) => Object.freeze({
        sourcePath: `packages/.native/${runtime.packageName}/${unit.path}`,
        objectPath: `build/native/${runtime.packageName}/${unit.digest}.o`,
        standard: unit.standard,
      }))),
    }));
  }
  return Object.freeze({
    dependencies: Object.freeze([...dependencies].map(([name, version]) =>
      Object.freeze({ name, version })).sort((left, right) =>
        left.name.localeCompare(right.name, "en"))),
    packages: Object.freeze(packages.sort((left, right) =>
      left.packageName.localeCompare(right.packageName, "en"))),
    staticLibraries: Object.freeze([...staticLibraries].sort((left, right) =>
      left.localeCompare(right, "en"))),
    dynamicLibraries: Object.freeze([...dynamicLibraries].sort((left, right) =>
      left.localeCompare(right, "en"))),
  });
}
