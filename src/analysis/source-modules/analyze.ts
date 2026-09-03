import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
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
        if (sourceFile === undefined) return undefined;
        return definitionBySourceFile.get(sourceFile) ??
          byFileName.get(normalizePath(input.source.ast.getFileName(sourceFile)));
      },
      forFileName(fileName: string) {
        return byFileName.get(normalizePath(fileName));
      },
    }),
  });
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function issue(code: string, message: string, node?: Node): MojoSourceModuleIssue {
  return Object.freeze({ code, message, ...(node === undefined ? {} : { node }) });
}
