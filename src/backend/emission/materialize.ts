import type { TargetCompileOutput, TargetSourceFile } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan } from "../artifact-model/project/output.js";
import { printPixiProject } from "../../print/project/pixi-project.js";
import { printMojoModule } from "../../print/source/index.js";

export function materializeMojoOutputPlan(plan: MojoOutputPlan): TargetCompileOutput {
  const components = new Map(plan.components.map((component) => [component.id, component]));
  const artifacts: import("@tsonic/target-api/artifacts").TargetArtifact[] = plan.sources.map(
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
  for (const runtime of plan.runtimePackages) {
    for (const source of runtime.sources) {
      artifacts.push(Object.freeze<TargetSourceFile>({
        kind: "source",
        language: "mojo",
        path: `packages/${runtime.packageName}/${source.path}`,
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
  return Object.freeze({ artifacts: Object.freeze(artifacts) });
}
