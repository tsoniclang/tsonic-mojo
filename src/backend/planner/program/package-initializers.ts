import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type {
  MojoOutputComponentInitializer,
  MojoOutputSourceFile,
} from "../../artifact-model/project/output.js";
import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoImportDeclaration,
} from "../../target-ast/index.js";
import type { MojoTargetProgram } from "../../../analysis/program/model.js";
import { normalizeMojoIdentifier } from "../../../target-model/names/identifiers.js";
import { normalizeMojoDeclarations } from "../../normalization/index.js";
import {
  mojoOutputPlanningDiagnostic,
  sortedMojoImports,
} from "./plan-support.js";

export function planPackageInitializers(
  program: MojoTargetProgram,
  plannedSources: readonly MojoOutputSourceFile[],
  diagnostics: TargetDiagnostic[],
): {
  readonly sources: readonly MojoOutputSourceFile[];
  readonly initializers: ReadonlyMap<string, MojoOutputComponentInitializer>;
} {
  const sources = new Map(plannedSources.map((source) => [
    outputSourceKey(source.componentId, source.path),
    source,
  ] as const));
  const initializers = new Map<string, MojoOutputComponentInitializer>();
  for (const package_ of program.modules.packages) {
    const directories = new Map(package_.moduleDirectories.map((modulePath) => [
      modulePath.join("/"),
      modulePath,
    ] as const));
    const rootModulePath = Object.freeze([package_.packageName]);
    directories.set(package_.packageName, rootModulePath);
    for (const modulePath of [...directories.values()].sort(compareModulePaths)) {
      const path = `src/${modulePath.join("/")}/__init__.mojo`;
      const key = outputSourceKey(package_.componentId, path);
      const existing = sources.get(key);
      const imports: MojoImportDeclaration[] = [...(existing?.module.imports ?? [])];
      const declarations: MojoDeclaration[] = [...(existing?.module.declarations ?? [])];
      if (package_.root && modulePath.length === 1) {
        imports.push(...entryExportImports(program, diagnostics, modulePath));
        const initialization = planLibraryPackageInitializer(
          program,
          package_.componentId,
          modulePath,
          imports,
          declarations,
          diagnostics,
        );
        if (initialization !== undefined) {
          imports.push(...initialization.imports);
          declarations.push(initialization.declaration);
          initializers.set(package_.componentId, initialization.contract);
        }
      }
      sources.set(key, Object.freeze({
        componentId: package_.componentId,
        path,
        module: Object.freeze({
          modulePath,
          imports: mergeMojoImports(imports),
          typeAliases: existing?.module.typeAliases ?? Object.freeze([]),
          declarations: normalizeMojoDeclarations(declarations),
        }),
      }));
    }
  }
  return Object.freeze({
    sources: Object.freeze([...sources.values()]),
    initializers: new Map(initializers),
  });
}

function entryExportImports(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
  facadeModulePath: readonly string[],
): readonly MojoImportDeclaration[] {
  const symbolsByModule = new Map<string, {
    readonly modulePath: readonly string[];
    readonly symbols: Map<string, { readonly name: string; readonly alias?: string }>;
  }>();
  const exportedNames = new Map<string, string>();
  for (const exported of program.modules.entryPoint.exports) {
    const owner = program.modules.forSourceFile(exported.sourceFile);
    const targetName = program.queries.bindingName(exported.declaration);
    if (owner === undefined || targetName === undefined) {
      diagnostics.push(mojoOutputPlanningDiagnostic(
        "MOJO_EXPORTED_DECLARATION_NOT_PLANNED",
        `Entry export '${exported.exportName}' has no exact planned Mojo declaration.`,
        exported.declaration,
      ));
      continue;
    }
    if (sameModulePath(owner.modulePath, facadeModulePath)) continue;
    const alias = normalizeMojoIdentifier(
      exported.exportName === "default" ? "defaultExport" : exported.exportName,
    );
    const previous = exportedNames.get(alias);
    if (previous !== undefined && previous !== exported.exportName) {
      diagnostics.push(mojoOutputPlanningDiagnostic(
        "MOJO_EXPORTED_NAME_COLLISION",
        `Entry exports '${previous}' and '${exported.exportName}' map to Mojo name '${alias}'.`,
        exported.declaration,
      ));
      continue;
    }
    exportedNames.set(alias, exported.exportName);
    const key = owner.modulePath.join("\0");
    const group = symbolsByModule.get(key) ?? {
      modulePath: owner.modulePath,
      symbols: new Map<string, { readonly name: string; readonly alias?: string }>(),
    };
    const symbol = Object.freeze({
      name: targetName,
      ...(alias === targetName ? {} : { alias }),
    });
    group.symbols.set(`${targetName}\0${alias}`, symbol);
    symbolsByModule.set(key, group);
  }
  return Object.freeze([...symbolsByModule.values()]
    .sort((left, right) => left.modulePath.join(".").localeCompare(right.modulePath.join("."), "en"))
    .map((group) => Object.freeze({
      kind: "symbols" as const,
      modulePath: group.modulePath,
      symbols: Object.freeze([...group.symbols.values()].sort((left, right) =>
        left.name.localeCompare(right.name, "en") ||
        (left.alias ?? "").localeCompare(right.alias ?? "", "en"))),
    })));
}

function planLibraryPackageInitializer(
  program: MojoTargetProgram,
  componentId: string,
  modulePath: readonly string[],
  existingImports: readonly MojoImportDeclaration[],
  existingDeclarations: readonly MojoDeclaration[],
  diagnostics: TargetDiagnostic[],
): {
  readonly imports: readonly MojoImportDeclaration[];
  readonly declaration: MojoFunctionDeclaration;
  readonly contract: MojoOutputComponentInitializer;
} | undefined {
  if (program.configuration.outputType !== "lib") return undefined;
  const entry = program.modules.entryPoint;
  const component = program.moduleInitialization.componentForModuleId(entry.id);
  if (component === undefined) {
    diagnostics.push(mojoOutputPlanningDiagnostic(
      "MOJO_LIBRARY_INITIALIZATION_COMPONENT_MISSING",
      "Library output has no sealed initialization component for its configured entry module.",
      entry.sourceFile,
    ));
    return undefined;
  }
  if (!component.runtimeInitializationRequired) return undefined;
  if (entry.componentId !== componentId) {
    diagnostics.push(mojoOutputPlanningDiagnostic(
      "MOJO_LIBRARY_INITIALIZATION_COMPONENT_MISMATCH",
      "The configured library entry module does not belong to its root output component.",
      entry.sourceFile,
    ));
    return undefined;
  }
  const owner = program.queries.moduleForId(component.ownerModuleId);
  const ownerDefinition = owner === undefined
    ? undefined
    : program.modules.forSourceFile(owner.sourceFile);
  if (owner === undefined || ownerDefinition === undefined) {
    diagnostics.push(mojoOutputPlanningDiagnostic(
      "MOJO_LIBRARY_INITIALIZATION_OWNER_MISSING",
      "Library output has no exact planned owner for its entry initialization component.",
      entry.sourceFile,
    ));
    return undefined;
  }
  const usedNames = packageInitializerUsedNames(existingImports, existingDeclarations);
  const name = allocatePackageInitializerName("_initialize_tsonic_package", usedNames);
  const imports: MojoImportDeclaration[] = [];
  const ownerName = sameModulePath(ownerDefinition.modulePath, modulePath)
    ? owner.initializeName
    : allocatePackageInitializerName("_initialize_tsonic_module", usedNames);
  if (!sameModulePath(ownerDefinition.modulePath, modulePath)) {
    imports.push(Object.freeze({
      kind: "symbols",
      modulePath: ownerDefinition.modulePath,
      symbols: Object.freeze([Object.freeze({
        name: owner.initializeName,
        ...(ownerName === owner.initializeName ? {} : { alias: ownerName }),
      })]),
    }));
  }
  let expression: import("../../target-ast/index.js").MojoExpression = Object.freeze({
    kind: "call",
    callee: Object.freeze({ kind: "path", path: ownerName }),
    arguments: Object.freeze([]),
  });
  if (component.asynchronous) {
    const sourceTaskFactory = component.raises ? "create_raising_task" : "create_task";
    const taskFactory = allocatePackageInitializerName(sourceTaskFactory, usedNames);
    imports.push(Object.freeze({
      kind: "symbols",
      modulePath: Object.freeze(["tsonic_runtime"]),
      symbols: Object.freeze([Object.freeze({
        name: sourceTaskFactory,
        ...(taskFactory === sourceTaskFactory ? {} : { alias: taskFactory }),
      })]),
    }));
    expression = Object.freeze({
      kind: "await",
      expression: Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: taskFactory }),
        arguments: Object.freeze([Object.freeze({ value: expression })]),
      }),
    });
  }
  const declaration: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: component.asynchronous,
    raises: component.raises,
    statements: Object.freeze([Object.freeze({ kind: "expression", expression })]),
  });
  return Object.freeze({
    imports: Object.freeze(imports),
    declaration,
    contract: Object.freeze({
      modulePath: Object.freeze([...modulePath]),
      name,
      asynchronous: component.asynchronous,
      raises: component.raises,
    }),
  });
}

function packageInitializerUsedNames(
  imports: readonly MojoImportDeclaration[],
  declarations: readonly MojoDeclaration[],
): Set<string> {
  const names = new Set(declarations.map((declaration) => declaration.name));
  for (const import_ of imports) {
    if (import_.kind === "module") {
      names.add(import_.alias ?? import_.modulePath[import_.modulePath.length - 1]!);
      continue;
    }
    for (const symbol of import_.symbols) names.add(symbol.alias ?? symbol.name);
  }
  return names;
}

function allocatePackageInitializerName(base: string, usedNames: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) candidate = `${base}_${suffix++}`;
  usedNames.add(candidate);
  return candidate;
}

function mergeMojoImports(imports: readonly MojoImportDeclaration[]): readonly MojoImportDeclaration[] {
  const modules = new Map<string, Extract<MojoImportDeclaration, { readonly kind: "module" }>>();
  const symbols = new Map<string, {
    readonly modulePath: readonly string[];
    readonly values: Map<string, { readonly name: string; readonly alias?: string }>;
  }>();
  for (const import_ of imports) {
    const moduleKey = import_.modulePath.join("\0");
    if (import_.kind === "module") {
      modules.set(`${moduleKey}\0${import_.alias ?? ""}`, import_);
      continue;
    }
    const group = symbols.get(moduleKey) ?? {
      modulePath: import_.modulePath,
      values: new Map<string, { readonly name: string; readonly alias?: string }>(),
    };
    for (const symbol of import_.symbols) {
      group.values.set(`${symbol.name}\0${symbol.alias ?? ""}`, symbol);
    }
    symbols.set(moduleKey, group);
  }
  return sortedMojoImports([
    ...modules.values(),
    ...[...symbols.values()].map((group) => Object.freeze({
      kind: "symbols" as const,
      modulePath: group.modulePath,
      symbols: Object.freeze([...group.values.values()].sort((left, right) =>
        left.name.localeCompare(right.name, "en") ||
        (left.alias ?? "").localeCompare(right.alias ?? "", "en"))),
    })),
  ]);
}

function outputSourceKey(componentId: string, path: string): string {
  return `${componentId}\0${path}`;
}

function compareModulePaths(left: readonly string[], right: readonly string[]): number {
  return left.join("/").localeCompare(right.join("/"), "en");
}

function sameModulePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

