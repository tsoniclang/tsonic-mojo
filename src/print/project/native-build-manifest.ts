import type { MojoOutputPlan } from "../../backend/artifact-model/project/output.js";
import { createMojoComponentBuilds } from "../../backend/artifact-model/project/component-builds.js";

export const mojoNativeBuildManifestPath = "mojo-native-build.json";

export function printMojoNativeBuildManifest(plan: MojoOutputPlan): string {
  const manifest = {
    schemaVersion: 2,
    toolchain: {
      kind: plan.configuration.toolchain.kind,
      compilerVersion: plan.configuration.toolchain.compilerVersion,
      channels: plan.configuration.toolchain.channels,
      platforms: plan.configuration.toolchain.platforms,
      commandEnvironment: plan.configuration.toolchain.commandEnvironment,
      cCompiler: plan.configuration.toolchain.cCompiler,
    },
    components: createMojoComponentBuilds(plan),
    dependencies: plan.nativeBuild.dependencies,
    packages: plan.nativeBuild.packages
      .filter((package_) => package_.translationUnits.length !== 0)
      .map((package_) => ({
        packageName: package_.packageName,
        digest: package_.digest,
        includeDirectories: package_.includeDirectories,
        translationUnits: package_.translationUnits,
      })),
    libraryDirectories: plan.nativeBuild.dependencies.length === 0
      ? []
      : [{ environmentVariable: "CONDA_PREFIX", path: "lib" }],
    staticLibraries: plan.nativeBuild.staticLibraries.map((path) => ({
      environmentVariable: "CONDA_PREFIX",
      path,
    })),
    dynamicLibraries: plan.nativeBuild.dynamicLibraries,
  };
  return `${JSON.stringify(manifest, undefined, 2)}\n`;
}
