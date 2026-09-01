import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import { planMojoSourceModuleIdentities } from "./identities.js";
import type {
  MojoSourceModuleAnalysis,
  MojoSourceModuleDefinition,
  MojoSourceModuleDependency,
  MojoSourceModuleExport,
  MojoSourceModuleIssue,
} from "./model.js";

export function analyzeMojoSourceModules(
  input: TargetCompileInput,
  packageName: string,
  sourceFiles: readonly SourceFile[],
): MojoSourceModuleAnalysis {
  const identityPlan = planMojoSourceModuleIdentities(input, packageName, sourceFiles);
  if (identityPlan.issues.length > 0 || identityPlan.entryPoint === undefined) {
    return Object.freeze({ kind: "rejected", issues: identityPlan.issues });
  }
  const definitionBySourceFile = new Map<SourceFile, MojoSourceModuleDefinition>();
  const dependenciesBySourceFile = new Map<SourceFile, readonly MojoSourceModuleDependency[]>();
  const exportsBySourceFile = new Map<SourceFile, readonly MojoSourceModuleExport[]>();
  const issues: MojoSourceModuleIssue[] = [];

  const partialDefinitions = new Map(identityPlan.identities.map((identity) =>
    [identity.sourceFile, Object.freeze({
      ...identity,
      dependencies: Object.freeze([]),
      exports: Object.freeze([]),
      topLevelAwait: input.source.navigation.moduleHasTopLevelAwait(identity.sourceFile),
      runtimeInitializationRequired: moduleRequiresRuntimeInitialization(identity.sourceFile, input),
    }) as MojoSourceModuleDefinition] as const));
  for (const identity of identityPlan.identities) {
    const dependencies: MojoSourceModuleDependency[] = [];
    const seenDependencies = new Set<string>();
    for (const dependency of input.source.navigation.moduleDependencies(identity.sourceFile)) {
      const target = partialDefinitions.get(dependency.sourceFile);
      if (target === undefined) {
        issues.push(issue(
          "MOJO_PROJECT_MODULE_DEPENDENCY_IDENTITY_MISSING",
          `Project module dependency from '${identity.fileName}' has no exact Mojo output identity.`,
          dependency.declaration,
        ));
        continue;
      }
      const key = `${dependency.kind}\0${target.id}\0${input.source.ast.text(dependency.moduleSpecifier)}`;
      if (seenDependencies.has(key)) continue;
      seenDependencies.add(key);
      dependencies.push(Object.freeze({
        kind: dependency.kind,
        declaration: dependency.declaration,
        moduleSpecifier: dependency.moduleSpecifier,
        target: Object.freeze({
          id: target.id,
          sourceFile: target.sourceFile,
          fileName: target.fileName,
          modulePath: target.modulePath,
        }),
      }));
    }
    dependenciesBySourceFile.set(identity.sourceFile, Object.freeze(dependencies));
    exportsBySourceFile.set(identity.sourceFile, Object.freeze(
      input.source.navigation.moduleExports(identity.sourceFile).map((exported) => Object.freeze({
        exportName: exported.exportName,
        declaration: exported.declaration,
        sourceFile: exported.sourceFile,
      })),
    ));
  }
  for (const identity of identityPlan.identities) {
    const partial = partialDefinitions.get(identity.sourceFile)!;
    definitionBySourceFile.set(identity.sourceFile, Object.freeze({
      ...partial,
      dependencies: dependenciesBySourceFile.get(identity.sourceFile) ?? Object.freeze([]),
      exports: exportsBySourceFile.get(identity.sourceFile) ?? Object.freeze([]),
    }));
  }
  diagnoseRuntimeCycles([...definitionBySourceFile.values()], issues);
  if (issues.length > 0) return Object.freeze({ kind: "rejected", issues: Object.freeze(issues) });
  const definitions = Object.freeze([...definitionBySourceFile.values()].sort((left, right) =>
    left.artifactPath.localeCompare(right.artifactPath, "en")));
  const byFileName = new Map(definitions.map((definition) =>
    [normalizePath(definition.fileName), definition] as const));
  const entryPoint = definitionBySourceFile.get(identityPlan.entryPoint.sourceFile)!;
  return Object.freeze({
    kind: "resolved",
    catalog: Object.freeze({
      definitions,
      packages: identityPlan.packages,
      entryPoint,
      forSourceFile(sourceFile: SourceFile | undefined) {
        return sourceFile === undefined ? undefined : definitionBySourceFile.get(sourceFile);
      },
      forFileName(fileName: string) {
        return byFileName.get(normalizePath(fileName));
      },
    }),
  });
}

function moduleRequiresRuntimeInitialization(
  sourceFile: SourceFile,
  input: TargetCompileInput,
): boolean {
  const { ast } = input.source;
  for (const statement of ast.statements(sourceFile)) {
    if (statement === undefined) return true;
    switch (ast.kindName(statement)) {
      case "KindImportDeclaration":
      case "KindExportDeclaration":
      case "KindFunctionDeclaration":
      case "KindInterfaceDeclaration":
      case "KindTypeAliasDeclaration":
      case "KindEndOfFile":
      case "KindEmptyStatement":
        continue;
      case "KindClassDeclaration":
        if (ast.members(statement).every((member) => member !== undefined &&
          ast.kindName(member) !== "KindClassStaticBlockDeclaration" &&
          !ast.hasModifierKind(member, "static"))) continue;
        return true;
      default:
        return true;
    }
  }
  return false;
}

function diagnoseRuntimeCycles(
  definitions: readonly MojoSourceModuleDefinition[],
  issues: MojoSourceModuleIssue[],
): void {
  const definitionBySourceFile = new Map(definitions.map((definition) =>
    [definition.sourceFile, definition] as const));
  const runtimeRequired = transitiveRuntimeInitialization(definitions, definitionBySourceFile);
  let nextIndex = 0;
  const indexes = new Map<MojoSourceModuleDefinition, number>();
  const lowLinks = new Map<MojoSourceModuleDefinition, number>();
  const stack: MojoSourceModuleDefinition[] = [];
  const active = new Set<MojoSourceModuleDefinition>();
  const visit = (definition: MojoSourceModuleDefinition): void => {
    const index = nextIndex++;
    indexes.set(definition, index);
    lowLinks.set(definition, index);
    stack.push(definition);
    active.add(definition);
    for (const dependency of definition.dependencies) {
      const target = definitionBySourceFile.get(dependency.target.sourceFile);
      if (target === undefined) continue;
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(definition, Math.min(lowLinks.get(definition)!, lowLinks.get(target)!));
      } else if (active.has(target)) {
        lowLinks.set(definition, Math.min(lowLinks.get(definition)!, indexes.get(target)!));
      }
    }
    if (lowLinks.get(definition) !== index) return;
    const component: MojoSourceModuleDefinition[] = [];
    for (;;) {
      const member = stack.pop()!;
      active.delete(member);
      component.push(member);
      if (member === definition) break;
    }
    const cyclic = component.length > 1 || component[0]!.dependencies.some((dependency) =>
      dependency.target.sourceFile === component[0]!.sourceFile);
    if (!cyclic || !component.some((member) => runtimeRequired.get(member) === true)) return;
    issues.push(issue(
      "MOJO_RUNTIME_MODULE_CYCLE_UNSUPPORTED",
      `Runtime ES module cycle '${component.map((member) => member.relativeSourcePath).sort().join(" -> ")}' requires live-binding and temporal-dead-zone semantics that are not represented by the pinned Mojo compiler.`,
      component[0]!.sourceFile,
    ));
  };
  for (const definition of definitions) if (!indexes.has(definition)) visit(definition);
}

function transitiveRuntimeInitialization(
  definitions: readonly MojoSourceModuleDefinition[],
  definitionBySourceFile: ReadonlyMap<SourceFile, MojoSourceModuleDefinition>,
): ReadonlyMap<MojoSourceModuleDefinition, boolean> {
  const required = new Map(definitions.map((definition) =>
    [definition, definition.runtimeInitializationRequired] as const));
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      if (required.get(definition) === true) continue;
      const dependencyRequiresRuntime = definition.dependencies.some((dependency) => {
        const target = definitionBySourceFile.get(dependency.target.sourceFile);
        return target !== undefined && required.get(target) === true;
      });
      if (!dependencyRequiresRuntime) continue;
      required.set(definition, true);
      changed = true;
    }
  }
  return required;
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function issue(code: string, message: string, node?: Node): MojoSourceModuleIssue {
  return Object.freeze({ code, message, ...(node === undefined ? {} : { node }) });
}
