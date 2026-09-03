import type { MojoOutputPlan } from "../../backend/artifact-model/project/output.js";

export function printPixiProject(plan: MojoOutputPlan): string {
  const root = plan.components.find((component) => component.root);
  if (root === undefined) throw new Error("A generated Mojo project requires one root component.");
  const dependencies = orderedDependencyComponents(plan, root.id);
  const dependencyTaskNames = new Map(dependencies.map((component) => [
    component.id,
    `build_${component.packageName}`,
  ]));
  const nativeTaskNames = new Map(plan.nativeBuild.packages
    .filter((package_) => package_.translationUnits.length !== 0)
    .map((package_) => [package_.packageName, `build_native_${package_.packageName}`]));
  const runtimeIncludes = plan.runtimePackages.length === 0 ? [] : ["-I 'packages'"];
  const rootIncludes = [
    "-I 'src'",
    ...componentIncludeArguments(root, plan),
    ...runtimeIncludes,
  ].join(" ");
  const output = plan.configuration.outputType === "bin"
    ? `build/${plan.configuration.packageName}`
    : `build/${plan.configuration.packageName}.mojoc`;
  const compilerCommand = plan.configuration.outputType === "bin"
    ? "mojo build"
    : "mojo precompile";
  const compilerInput = plan.configuration.outputType === "bin"
    ? "src/main.mojo"
    : `src/${plan.configuration.packageName}`;
  const buildCommand = [
    "mkdir -p build &&",
    compilerCommand,
    rootIncludes,
    shellQuote(compilerInput),
    "-o",
    shellQuote(output),
    ...nativeLinkArguments(plan),
  ].filter((part) => part.length > 0).join(" ");
  const lines = [
    "[workspace]",
    `name = ${JSON.stringify(plan.configuration.packageName)}`,
    `channels = ${tomlStringArray(plan.configuration.toolchain.channels)}`,
    `platforms = ${tomlStringArray(plan.configuration.toolchain.platforms)}`,
    "",
    "[dependencies]",
    `mojo = ${JSON.stringify(`==${plan.configuration.toolchain.compilerVersion}`)}`,
    ...plan.nativeBuild.dependencies.map((dependency) =>
      `${dependency.name} = ${JSON.stringify(dependency.version)}`),
    "",
    "[tasks]",
  ];
  for (const package_ of plan.nativeBuild.packages) {
    const taskName = nativeTaskNames.get(package_.packageName);
    if (taskName === undefined) continue;
    const commands = package_.translationUnits.map((unit) => [
      `mkdir -p ${shellQuote(parentPath(unit.objectPath))} &&`,
      `"$CC" -O3 -fPIC -std=${unit.standard}`,
      ...package_.includeDirectories.map((path) =>
        `-I${shellEnvironmentPath(path)}`),
      "-c",
      shellQuote(unit.sourcePath),
      "-o",
      shellQuote(unit.objectPath),
    ].join(" "));
    lines.push(`${taskName} = ${tomlTask(commands.join(" && "), [])}`);
  }
  for (const component of dependencies) {
    const taskName = dependencyTaskNames.get(component.id)!;
    const componentDependencies = component.dependencies
      .map((dependencyId) => dependencyTaskNames.get(dependencyId))
      .filter((name): name is string => name !== undefined)
      .sort((left, right) => left.localeCompare(right, "en"));
    const command = [
      `mkdir -p ${shellQuote(componentArtifactDirectory(component))} &&`,
      "mojo precompile",
      [...componentIncludeArguments(component, plan), ...runtimeIncludes].join(" "),
      shellQuote(`components/${component.packageName}/src/${component.packageName}`),
      "-o",
      shellQuote(`${componentArtifactDirectory(component)}/${component.packageName}.mojoc`),
    ].filter((part) => part.length > 0).join(" ");
    lines.push(`${taskName} = ${tomlTask(command, componentDependencies)}`);
  }
  lines.push(`build = ${tomlTask(
    buildCommand,
    [
      ...root.dependencies
      .map((dependencyId) => dependencyTaskNames.get(dependencyId))
      .filter((name): name is string => name !== undefined),
      ...nativeTaskNames.values(),
    ].sort((left, right) => left.localeCompare(right, "en")),
  )}`);
  if (plan.configuration.outputType === "bin") {
    lines.push(`run = ${tomlTask(shellQuote(output), ["build"])}`);
  }
  return `${lines.join("\n")}\n`;
}

function nativeLinkArguments(plan: MojoOutputPlan): readonly string[] {
  return Object.freeze([
    ...plan.nativeBuild.packages.flatMap((package_) =>
      package_.translationUnits.map((unit) => `-Xlinker ${shellQuote(unit.objectPath)}`)),
    ...plan.nativeBuild.staticLibraries.map((path) =>
      `-Xlinker ${shellEnvironmentPath(path)}`),
    ...plan.nativeBuild.dynamicLibraries.map((library) => `-Xlinker -l${library}`),
  ]);
}

function shellEnvironmentPath(path: string): string {
  return `"$CONDA_PREFIX/${path.replace(/["`$\\]/gu, "\\$&")}"`;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "." : path.slice(0, separator);
}

function orderedDependencyComponents(
  plan: MojoOutputPlan,
  rootId: string,
): MojoOutputPlan["components"] {
  const byId = new Map(plan.components.map((component) => [component.id, component]));
  const ordered: MojoOutputPlan["components"][number][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>([rootId]);
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Mojo component artifact graph contains cycle '${id}'.`);
    const component = byId.get(id);
    if (component === undefined) throw new Error(`Mojo component artifact '${id}' is missing.`);
    visiting.add(id);
    for (const dependency of component.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(component);
  };
  const root = byId.get(rootId);
  if (root === undefined) throw new Error("Mojo root component artifact is missing.");
  for (const dependency of root.dependencies) visit(dependency);
  return Object.freeze(ordered);
}

function tomlTask(command: string, dependencies: readonly string[]): string {
  return dependencies.length === 0
    ? JSON.stringify(command)
    : `{ cmd = ${JSON.stringify(command)}, depends-on = ${tomlStringArray(dependencies)} }`;
}

function componentIncludeArguments(
  component: MojoOutputPlan["components"][number],
  plan: MojoOutputPlan,
): readonly string[] {
  const byId = new Map(plan.components.map((candidate) => [candidate.id, candidate]));
  return Object.freeze(component.dependencies.map((dependencyId) => {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined) {
      throw new Error(`Mojo component dependency '${dependencyId}' is missing.`);
    }
    return `-I ${shellQuote(componentArtifactDirectory(dependency))}`;
  }));
}

function componentArtifactDirectory(
  component: MojoOutputPlan["components"][number],
): string {
  return `build/components/${component.artifactKey}`;
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}
