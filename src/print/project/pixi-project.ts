import type { MojoOutputPlan } from "../../backend/artifact-model/project/output.js";
import { createMojoComponentBuilds } from "../../backend/artifact-model/project/component-builds.js";

export function printPixiProject(plan: MojoOutputPlan): string {
  const builds = createMojoComponentBuilds(plan);
  const root = builds.find((component) => component.root);
  if (root === undefined) throw new Error("A generated Mojo project requires one root component.");
  const dependencies = builds.filter((component) => !component.root);
  const dependencyTaskNames = new Map(dependencies.map((component) => [
    component.id,
    `build_${component.packageName}`,
  ]));
  const nativeTaskNames = new Map(plan.nativeBuild.packages
    .filter((package_) => package_.translationUnits.length !== 0)
    .map((package_) => [package_.packageName, `build_native_${package_.packageName}`]));
  const rootIncludes = root.includeDirectories.map((directory) => `-I ${shellQuote(directory)}`).join(" ");
  const output = root.artifactPath;
  const compilerCommand = root.kind === "executable"
    ? "mojo build"
    : "mojo precompile";
  const compilerInput = root.sourcePath;
  const buildCommand = [
    "mkdir -p build &&",
    compilerCommand,
    rootIncludes,
    shellQuote(compilerInput),
    "-o",
    shellQuote(output),
    ...(plan.configuration.outputType === "bin" ? nativeLinkArguments(plan) : []),
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
      `${plan.configuration.toolchain.cCompiler} -O3 -fPIC -std=${unit.standard}`,
      `-I"$CONDA_PREFIX/include"`,
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
      `mkdir -p ${shellQuote(parentPath(component.artifactPath))} &&`,
      "mojo precompile",
      component.includeDirectories.map((directory) => `-I ${shellQuote(directory)}`).join(" "),
      shellQuote(component.sourcePath),
      "-o",
      shellQuote(component.artifactPath),
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
    ...(plan.nativeBuild.dependencies.length === 0
      ? []
      : [`-Xlinker -L"$CONDA_PREFIX/lib"`]),
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

function tomlTask(command: string, dependencies: readonly string[]): string {
  return dependencies.length === 0
    ? JSON.stringify(command)
    : `{ cmd = ${JSON.stringify(command)}, depends-on = ${tomlStringArray(dependencies)} }`;
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}
