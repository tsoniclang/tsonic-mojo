import type { MojoOutputPlan } from "./output.js";

export interface MojoComponentBuild {
  readonly id: string;
  readonly packageName: string;
  readonly root: boolean;
  readonly artifactKey: string;
  readonly dependencies: readonly string[];
  readonly kind: "library" | "executable";
  readonly sourcePath: string;
  readonly artifactPath: string;
  readonly includeDirectories: readonly string[];
}

export function createMojoComponentBuilds(plan: MojoOutputPlan): readonly MojoComponentBuild[] {
  const byId = new Map(plan.components.map((component) => [component.id, component]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: MojoComponentBuild[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Mojo component artifact graph contains cycle '${id}'.`);
    const component = byId.get(id);
    if (component === undefined) throw new Error(`Mojo component artifact '${id}' is missing.`);
    visiting.add(id);
    for (const dependency of component.dependencies) visit(dependency);
    visiting.delete(id);
    const executable = component.root && plan.configuration.outputType === "bin";
    const sourceRoot = component.root ? "src" : `components/${component.packageName}/src`;
    const outputRoot = component.root ? "build" : `build/components/${component.artifactKey}`;
    result.push(Object.freeze({
      id,
      packageName: component.packageName,
      root: component.root,
      artifactKey: component.artifactKey,
      dependencies: component.dependencies,
      kind: executable ? "executable" : "library",
      sourcePath: executable ? "src/main.mojo" : `${sourceRoot}/${component.packageName}`,
      artifactPath: `${outputRoot}/${component.packageName}${executable ? "" : ".mojoc"}`,
      includeDirectories: Object.freeze([
        ...(component.root ? [sourceRoot] : []),
        ...component.dependencies.map((dependency) =>
          `build/components/${byId.get(dependency)!.artifactKey}`),
        ...(plan.runtimePackages.length === 0 ? [] : ["packages"]),
      ]),
    }));
    visited.add(id);
  };
  const roots = plan.components.filter((component) => component.root);
  if (roots.length !== 1) throw new Error("A generated Mojo project requires exactly one root component.");
  visit(roots[0]!.id);
  if (visited.size !== plan.components.length) throw new Error("Mojo output contains unreachable components.");
  return Object.freeze(result);
}
