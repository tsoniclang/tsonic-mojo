import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoSourceModuleArgument, MojoSourceModuleBootstrap } from "../../target-model/operations/source-module.js";
import type { MojoAnalyzedCallArgument, MojoCallSelection } from "../operations/call-model.js";
import type { MojoSourceModuleCatalog } from "./model.js";

export interface MojoSourceModuleConstruction {
  readonly sourceFile: SourceFile;
  readonly argument: Node;
  readonly parameterIndex: number;
  readonly identity: string;
  readonly bootstrap: MojoSourceModuleBootstrap;
}

export function analyzeMojoSourceModuleConstruction(input: {
  readonly contract: MojoSourceModuleArgument;
  readonly arguments: readonly MojoAnalyzedCallArgument[];
  readonly source: TargetSourceProgram;
  readonly modulePathForSourceFile: (sourceFile: SourceFile) => readonly string[];
}): { readonly kind: "resolved"; readonly construction: MojoSourceModuleConstruction } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const arguments_ = input.arguments.filter((argument) => argument.parameterIndex === input.contract.parameterIndex);
  const argument = arguments_[0];
  if (arguments_.length !== 1 || argument?.sourceForm !== "value" ||
    !["KindStringLiteral", "KindNoSubstitutionTemplateLiteral"].includes(input.source.ast.kindName(argument.expression))) {
    return { kind: "unsupported", code: "MOJO_SOURCE_MODULE_ARGUMENT_NOT_STATIC", reason: "A source-module construction requires one exact authored string-literal module argument." };
  }
  const resolution = input.source.navigation.moduleSpecifierResolution(argument.expression);
  if (resolution.kind !== "project") {
    return { kind: "unsupported", code: "MOJO_SOURCE_MODULE_ARGUMENT_NOT_PROJECT_SOURCE", reason: "The selected source-module argument must resolve to an exact checked project module." };
  }
  const modulePath = input.modulePathForSourceFile(resolution.sourceFile);
  if (modulePath.length === 0) {
    return { kind: "unsupported", code: "MOJO_SOURCE_MODULE_OUTPUT_IDENTITY_MISSING", reason: "The selected checked module has no exact generated module identity." };
  }
  return { kind: "resolved", construction: Object.freeze({
    sourceFile: resolution.sourceFile,
    argument: argument.expression,
    parameterIndex: input.contract.parameterIndex,
    identity: modulePath.join("."),
    bootstrap: input.contract.bootstrap,
  }) };
}

export function collectMojoSourceModuleConstructions(input: {
  readonly calls: Iterable<Node>;
  readonly selections: WeakMap<Node, MojoCallSelection>;
  readonly modules: MojoSourceModuleCatalog;
  readonly binaryOutput: boolean;
}): {
  readonly entries: readonly MojoSourceModuleConstruction[];
  readonly issues: readonly { readonly node: Node; readonly code: string; readonly message: string }[];
} {
  const entries = new Map<string, MojoSourceModuleConstruction>();
  const bootstraps = new Map<string, MojoSourceModuleBootstrap>();
  const bootstrapOwners = new Map<string, string>();
  const issues: { readonly node: Node; readonly code: string; readonly message: string }[] = [];
  for (const call of input.calls) {
    const selected = input.selections.get(call);
    const construction = selected?.kind === "provider" ? selected.sourceModule : undefined;
    if (construction === undefined) continue;
    if (!input.binaryOutput) {
      issues.push({ node: call, code: "MOJO_SOURCE_MODULE_CONSTRUCTION_REQUIRES_BINARY", message: "A compiled source-module construction requires a closed executable entry dispatcher." });
      continue;
    }
    const module = input.modules.forSourceFile(construction.sourceFile);
    if (module?.modulePath.join(".") !== construction.identity) {
      issues.push({ node: call, code: "MOJO_SOURCE_MODULE_OUTPUT_IDENTITY_CONFLICT", message: "A selected module entry disagrees with the sealed output identity." });
      continue;
    }
    const bootstrap = construction.bootstrap;
    const probeIdentity = JSON.stringify([bootstrap.modulePath, bootstrap.entryName]);
    const probeOwner = bootstrapOwners.get(probeIdentity);
    if (probeOwner !== undefined && probeOwner !== bootstrap.id) {
      issues.push({ node: call, code: "MOJO_SOURCE_MODULE_BOOTSTRAP_CONFLICT", message: "A source-module bootstrap probe has conflicting provider ownership identities." });
      continue;
    }
    const existing = bootstraps.get(bootstrap.id);
    if (existing !== undefined && (existing.entryName !== bootstrap.entryName ||
      existing.completeName !== bootstrap.completeName || existing.modulePath.join(".") !== bootstrap.modulePath.join("."))) {
      issues.push({ node: call, code: "MOJO_SOURCE_MODULE_BOOTSTRAP_CONFLICT", message: `Provider bootstrap '${bootstrap.id}' has conflicting entry contracts.` });
      continue;
    }
    bootstraps.set(bootstrap.id, bootstrap);
    bootstrapOwners.set(probeIdentity, bootstrap.id);
    entries.set(JSON.stringify([bootstrap.id, construction.identity]), construction);
  }
  return Object.freeze({ entries: Object.freeze([...entries.values()].sort((left, right) =>
    left.bootstrap.id.localeCompare(right.bootstrap.id, "en") || left.identity.localeCompare(right.identity, "en"))), issues: Object.freeze(issues) });
}
