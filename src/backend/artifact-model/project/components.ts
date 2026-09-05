import { createHash } from "node:crypto";
import type { MojoRuntimePackagePlan } from "../../../analysis/program/model.js";
import type { MojoSourcePackageDefinition } from "../../../analysis/source-modules/model.js";
import type { MojoTargetConfiguration } from "../../../target-model/configuration/model.js";
import type {
  MojoOutputComponent,
  MojoOutputComponentInitializer,
  MojoOutputSourceFile,
} from "./output.js";

export function createMojoOutputComponents(
  packages: readonly MojoSourcePackageDefinition[],
  sources: readonly MojoOutputSourceFile[],
  runtimePackages: readonly MojoRuntimePackagePlan[],
  configuration: MojoTargetConfiguration,
  initializers: ReadonlyMap<string, MojoOutputComponentInitializer>,
): readonly MojoOutputComponent[] {
  const packageById = new Map(packages.map((package_) => [package_.componentId, package_]));
  const keyById = new Map<string, string>();
  const visiting = new Set<string>();
  const componentKey = (id: string): string => {
    const existing = keyById.get(id);
    if (existing !== undefined) return existing;
    if (visiting.has(id)) throw new Error(`Mojo source-package component graph contains cycle '${id}'.`);
    const package_ = packageById.get(id);
    if (package_ === undefined) throw new Error(`Mojo source-package component '${id}' is missing.`);
    visiting.add(id);
    const dependencies = package_.dependencies.map((dependency) => Object.freeze({
      id: dependency,
      key: componentKey(dependency),
    }));
    visiting.delete(id);
    const componentSources = sources
      .filter((source) => source.componentId === id)
      .sort((left, right) => left.path.localeCompare(right.path, "en"))
      .map((source) => Object.freeze({ path: source.path, module: source.module }));
    const key = createHash("sha256").update(JSON.stringify({
      contractVersion: 1,
      compilerVersion: configuration.toolchain.compilerVersion,
      packageName: package_.packageName,
      dependencies,
      runtimePackages: runtimePackages.map((runtime) => Object.freeze({
        packageName: runtime.packageName,
        digest: runtime.digest,
        nativeDigest: runtime.native?.digest,
      })),
      sources: componentSources,
    })).digest("hex");
    keyById.set(id, key);
    return key;
  };
  return Object.freeze(packages.map((package_) => Object.freeze({
    id: package_.componentId,
    packageName: package_.packageName,
    root: package_.root,
    dependencies: package_.dependencies,
    artifactKey: componentKey(package_.componentId),
    ...(initializers.get(package_.componentId) === undefined
      ? {}
      : { initializer: initializers.get(package_.componentId)! }),
  })).sort((left, right) => left.packageName.localeCompare(right.packageName, "en")));
}
