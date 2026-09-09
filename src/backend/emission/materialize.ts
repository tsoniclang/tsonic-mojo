import type { TargetCompileOutput, TargetSourceFile } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan } from "../artifact-model/project/output.js";
import { printPixiProject } from "../../print/project/pixi-project.js";
import {
  mojoNativeBuildManifestPath,
  printMojoNativeBuildManifest,
} from "../../print/project/native-build-manifest.js";
import { printMojoModule } from "../../print/source/index.js";
import { formatMojoCompileOutput } from "./mojo-format.js";

export function materializeMojoOutputPlan(plan: MojoOutputPlan): TargetCompileOutput {
  const components = new Map(plan.components.map((component) => [component.id, component]));
  const sources = plan.sources.map(
    (source) => {
      const component = components.get(source.componentId);
      if (component === undefined) {
        throw new Error(`Mojo source '${source.path}' has no sealed output component.`);
      }
      return Object.freeze<TargetSourceFile>({
        kind: "source",
        language: "mojo",
        path: component.root
          ? source.path
          : `components/${component.packageName}/${source.path}`,
        text: printMojoModule(source.module),
      });
    },
  );
  const formatted = formatMojoCompileOutput(
    Object.freeze({ artifacts: Object.freeze(sources) }),
    plan.configuration.compilerProvider.command,
    plan.configuration.toolchain.compilerVersion,
  );
  const artifacts: import("@tsonic/target-api/artifacts").TargetArtifact[] = [...formatted.artifacts];
  for (const runtime of plan.runtimePackages) {
    for (const source of runtime.sources) {
      artifacts.push(Object.freeze<TargetSourceFile>({
        kind: "source",
        language: "mojo",
        path: `packages/${runtime.packageName}/${source.path}`,
        text: source.text,
      }));
    }
    const native = runtime.native;
    for (const source of native === undefined ? [] : [...native.translationUnits, ...native.assets]) {
      artifacts.push(Object.freeze({
        kind: "asset",
        path: `packages/.native/${runtime.packageName}/${source.path}`,
        text: source.text,
      }));
    }
  }
  if (plan.configuration.project.kind === "generated") {
    artifacts.push(Object.freeze({
      kind: "project",
      path: "pixi.toml",
      text: printPixiProject(plan),
    }));
  }
  artifacts.push(Object.freeze({
    kind: "project",
    path: mojoNativeBuildManifestPath,
    text: printMojoNativeBuildManifest(plan),
  }));
  return Object.freeze({ artifacts: Object.freeze(artifacts) });
}
