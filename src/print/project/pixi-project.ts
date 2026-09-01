import type { MojoOutputPlan } from "../../backend/artifact-model/project/output.js";

export function printPixiProject(plan: MojoOutputPlan, sourcePath: string): string {
  const includeArguments = ["-I 'src'", ...(plan.runtimePackages.length === 0 ? [] : ["-I 'packages'"])]
    .join(" ");
  const output = plan.configuration.outputType === "bin"
    ? `build/${plan.configuration.packageName}`
    : `build/${plan.configuration.packageName}.mojoc`;
  const compilerCommand = plan.configuration.outputType === "bin"
    ? "mojo build"
    : "mojo precompile";
  const compilerInput = plan.configuration.outputType === "bin"
    ? sourcePath
    : `src/${plan.configuration.packageName}`;
  const buildCommand = [
    "mkdir -p build &&",
    compilerCommand,
    includeArguments,
    shellQuote(compilerInput),
    "-o",
    shellQuote(output),
  ].filter((part) => part.length > 0).join(" ");
  const lines = [
    "[workspace]",
    `name = ${JSON.stringify(plan.configuration.packageName)}`,
    'channels = ["conda-forge", "https://conda.modular.com/max-nightly/"]',
    'platforms = ["linux-64"]',
    "",
    "[dependencies]",
    `mojo = ${JSON.stringify(`==${plan.configuration.toolchainVersion}`)}`,
    "",
    "[tasks]",
    `build = ${JSON.stringify(buildCommand)}`,
  ];
  if (plan.configuration.outputType === "bin") {
    lines.push(`run = ${JSON.stringify(["pixi run build &&", shellQuote(output)].join(" "))}`);
  }
  return `${lines.join("\n")}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}
