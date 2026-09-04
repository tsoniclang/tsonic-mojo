import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type {
  MojoOutputComponentInitializer,
  MojoOutputPlan,
  MojoOutputSourceFile,
} from "../../artifact-model/project/output.js";
import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoImportDeclaration,
  MojoSourceModule,
  MojoStatement,
} from "../../target-ast/index.js";
import {
  createMojoPlanningContext,
} from "./context.js";
import type {
  MojoOutputPlanningContext,
} from "./context.js";
import type {
  MojoTargetProgram,
} from "../../../analysis/program/model.js";
import { normalizeMojoIdentifier } from "../../../target-model/names/identifiers.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import { planMojoModuleState } from "./module-state.js";
import { planMojoPublicModuleExports } from "./public-exports.js";
import { planMojoInterface } from "../declarations/interfaces.js";
import {
  planMojoPolymorphicInterface,
  planMojoPolymorphicProjectClass,
} from "../objects/polymorphism/index.js";
import {
  planMojoProjectClass,
  planMojoProjectEnum,
  planMojoProjectFunctionVariants,
  planMojoProjectTypeAlias,
} from "../declarations/project.js";
import { planMojoPhysicalTypeAliases } from "../types/aliases.js";
import { normalizeMojoDeclarations } from "../../normalization/index.js";
import { createMojoOutputComponents } from "../../artifact-model/project/components.js";
import { createMojoNativeBuildPlan } from "../../artifact-model/project/native.js";
import { planMojoTopLevelImplementationAdapter } from "../callables/implementation-adapters.js";

export function planMojoOutput(
  input: MojoOutputPlanningContext,
): TargetStageResult<MojoOutputPlan> {
  const { program } = input;
  const diagnostics: TargetDiagnostic[] = [];
  const sources: MojoOutputSourceFile[] = [];
  for (const module of program.modules.definitions) {
    const planned = planSourceModule(program, module);
    if (planned.kind === "rejected") diagnostics.push(...planned.diagnostics);
    else sources.push(planned.source);
  }
  const packageLayout = planPackageInitializers(program, sources, diagnostics);
  sources.splice(0, sources.length, ...packageLayout.sources);
  if (program.configuration.outputType === "bin") {
    const main = planBinaryEntry(program, diagnostics);
    if (main !== undefined) sources.push(main);
  }
  const duplicatePaths = duplicateSourcePaths(sources);
  for (const path of duplicatePaths) {
    diagnostics.push(planningDiagnostic(
      "MOJO_OUTPUT_SOURCE_PATH_CONFLICT",
      `Multiple sealed Mojo source modules map to output path '${path}'.`,
    ));
  }
  if (diagnostics.length > 0) return rejectedTargetStage(Object.freeze(diagnostics));
  const orderedSources = Object.freeze([...sources].sort((left, right) =>
    left.path.localeCompare(right.path, "en")));
  return resolvedTargetStage(Object.freeze({
    configuration: program.configuration,
    components: createMojoOutputComponents(
      program.modules.packages,
      orderedSources,
      program.runtimePackages,
      program.configuration,
      packageLayout.initializers,
    ),
    sources: orderedSources,
    runtimePackages: program.runtimePackages,
    nativeBuild: createMojoNativeBuildPlan(program.runtimePackages),
  }));
}

function planSourceModule(
  program: MojoTargetProgram,
  module: MojoSourceModuleDefinition,
):
  | { readonly kind: "resolved"; readonly source: MojoOutputSourceFile }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const context = createMojoPlanningContext(program, module);
  const declarations: MojoDeclaration[] = [];
  const analyzedModule = program.queries.moduleForId(module.id);
  if (analyzedModule === undefined) {
    context.diagnostics.push(planningDiagnostic(
      "MOJO_ANALYZED_MODULE_MISSING",
      `Source module '${module.relativeSourcePath}' has no sealed target analysis.`,
      module.sourceFile,
    ));
  } else {
    const stateDiagnosticCount = context.diagnostics.length;
    const state = planMojoModuleState(program, module, analyzedModule, context);
    if (state !== undefined) {
      declarations.push(...state);
      const publicExports = planMojoPublicModuleExports(program, module, context);
      if (publicExports !== undefined) declarations.push(...publicExports);
    } else if (context.diagnostics.length === stateDiagnosticCount) {
      context.diagnostics.push(planningDiagnostic(
        "MOJO_MODULE_STATE_NOT_PLANNED",
        `Source module '${module.relativeSourcePath}' has no exact sealed module-state plan.`,
        module.sourceFile,
      ));
    }
  }
  for (const adapter of program.callableImplementationAdapters) {
    if (adapter.kind !== "top-level-function-overload") continue;
    if (program.modules.forSourceFile(adapter.sourceFile)?.id !== module.id) continue;
    const diagnosticCount = context.diagnostics.length;
    const planned = planMojoTopLevelImplementationAdapter(adapter, context);
    if (planned !== undefined) {
      declarations.push(planned);
    } else if (context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(planningDiagnostic(
        "MOJO_SEALED_CALLABLE_ADAPTER_PLAN_MISSING",
        `Sealed overload adapter '${adapter.name}' has no mechanical Mojo declaration plan.`,
        adapter.contract.declaration,
      ));
    }
  }
  for (const declaration of program.declarations) {
    if (program.modules.forSourceFile(declaration.sourceFile)?.id !== module.id) continue;
    if (declaration.kind === "class") {
      const diagnosticCount = context.diagnostics.length;
      const planned = declaration.polymorphic
        ? planMojoPolymorphicProjectClass(declaration, context)
        : planMojoProjectClass(declaration, context);
      if (planned !== undefined) {
        declarations.push(...planned);
      } else if (context.diagnostics.length === diagnosticCount) {
        context.diagnostics.push(planningDiagnostic(
          "MOJO_PROJECT_CLASS_NOT_PLANNED",
          `Project class '${declaration.name}' has no exact sealed Mojo declaration plan.`,
          declaration.declaration,
        ));
      }
      continue;
    }
    if (declaration.kind === "enum") {
      declarations.push(planMojoProjectEnum(declaration));
      continue;
    }
    if (declaration.kind === "interface") {
      if (!declaration.polymorphic) {
        declarations.push(...planMojoInterface(declaration, context));
        continue;
      }
      const diagnosticCount = context.diagnostics.length;
      const planned = planMojoPolymorphicInterface(declaration, context);
      if (planned !== undefined) {
        declarations.push(...planned);
      } else if (context.diagnostics.length === diagnosticCount) {
        context.diagnostics.push(planningDiagnostic(
          "MOJO_PROJECT_INTERFACE_NOT_PLANNED",
          `Project interface '${declaration.name}' has no exact sealed Mojo declaration plan.`,
          declaration.declaration,
        ));
      }
      continue;
    }
    if (declaration.kind === "type-alias") {
      declarations.push(planMojoProjectTypeAlias(declaration, context));
      continue;
    }
    const diagnosticCount = context.diagnostics.length;
    const planned = planMojoProjectFunctionVariants(declaration, context);
    if (planned !== undefined) {
      declarations.push(...planned);
    } else if (context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(planningDiagnostic(
        "MOJO_PROJECT_FUNCTION_NOT_PLANNED",
        `Project function '${declaration.name}' has no exact sealed Mojo declaration plan.`,
        declaration.declaration,
      ));
    }
  }
  if (context.diagnostics.length > 0) {
    return Object.freeze({ kind: "rejected", diagnostics: Object.freeze(context.diagnostics) });
  }
  const plannedDeclarations = normalizeMojoDeclarations([
    ...declarations,
    ...context.syntheticDeclarations,
  ]);
  const physicalTypeAliases = planMojoPhysicalTypeAliases(plannedDeclarations, context);
  return Object.freeze({
    kind: "resolved",
    source: Object.freeze({
      componentId: module.componentId,
      path: module.artifactPath,
      module: Object.freeze({
        modulePath: module.modulePath,
        imports: sortedImports(context.imports.values()),
        typeAliases: Object.freeze([...context.typeAliases.values()].sort((left, right) =>
          left.typeKey.localeCompare(right.typeKey, "en"))),
        declarations: Object.freeze([...physicalTypeAliases, ...plannedDeclarations]),
      }),
    }),
  });
}

function planPackageInitializers(
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
      diagnostics.push(planningDiagnostic(
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
      diagnostics.push(planningDiagnostic(
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
    diagnostics.push(planningDiagnostic(
      "MOJO_LIBRARY_INITIALIZATION_COMPONENT_MISSING",
      "Library output has no sealed initialization component for its configured entry module.",
      entry.sourceFile,
    ));
    return undefined;
  }
  if (!component.runtimeInitializationRequired) return undefined;
  if (entry.componentId !== componentId) {
    diagnostics.push(planningDiagnostic(
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
    diagnostics.push(planningDiagnostic(
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
  return sortedImports([
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

function planBinaryEntry(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
): MojoOutputSourceFile | undefined {
  const entry = program.modules.entryPoint;
  const function_ = program.binaryEntry;
  if (function_ === undefined) {
    diagnostics.push(planningDiagnostic(
      "MOJO_BINARY_ENTRY_PLAN_MISSING",
      "Binary output has no exact sealed entry ABI plan.",
      entry.sourceFile,
    ));
    return undefined;
  }
  const importedName = "_entry";
  const analyzedEntry = program.queries.moduleForId(entry.id);
  const initialization = program.moduleInitialization.componentForModuleId(entry.id);
  const initializationOwner = initialization === undefined
    ? undefined
    : program.queries.moduleForId(initialization.ownerModuleId);
  const initializationOwnerDefinition = initializationOwner === undefined
    ? undefined
    : program.modules.forSourceFile(initializationOwner.sourceFile);
  if (analyzedEntry === undefined || initialization === undefined ||
    initializationOwner === undefined || initializationOwnerDefinition === undefined) {
    diagnostics.push(planningDiagnostic(
      "MOJO_BINARY_ENTRY_MODULE_ANALYSIS_MISSING",
      "Binary entry module has no sealed Mojo module and initialization-component analysis.",
      entry.sourceFile,
    ));
    return undefined;
  }
  const initializerName = "_initialize_entry";
  const sameInitializationModule = initializationOwnerDefinition.id === entry.id;
  const entryImportSymbols = [
    Object.freeze({ name: function_.name, alias: importedName }),
    ...(initialization.runtimeInitializationRequired && sameInitializationModule
      ? [Object.freeze({ name: initializationOwner.initializeName, alias: initializerName })]
      : []),
  ];
  const asynchronousBootstrap = function_.asynchronous || initialization.asynchronous;
  const sourceEntryRaises = function_.raises || initialization.raises;
  const binaryRaises = sourceEntryRaises ||
    program.binaryEpilogues.some((epilogue) => epilogue.raises === true);
  const bootstrapName = "_async_entry";
  const call = (path: string) => Object.freeze({
    kind: "call" as const,
    callee: Object.freeze({ kind: "path" as const, path }),
    arguments: Object.freeze([]),
  });
  const taskFactory = (raises: boolean): string => raises
    ? "create_raising_task"
    : "create_task";
  const maybeAwait = (path: string, asynchronous: boolean, raises: boolean) => asynchronous
    ? Object.freeze({
        kind: "await" as const,
        expression: Object.freeze({
          kind: "call" as const,
          callee: Object.freeze({ kind: "path" as const, path: taskFactory(raises) }),
          arguments: Object.freeze([Object.freeze({ value: call(path) })]),
        }),
      })
    : call(path);
  const taskFactories = [...new Set([
    ...(asynchronousBootstrap ? [taskFactory(sourceEntryRaises)] : []),
    ...(initialization.runtimeInitializationRequired && initialization.asynchronous
      ? [taskFactory(initialization.raises)]
      : []),
    ...(function_.asynchronous ? [taskFactory(function_.raises)] : []),
  ])];
  const sourceBootstrapStatements: readonly MojoStatement[] = Object.freeze([
    ...(initialization.runtimeInitializationRequired
      ? [Object.freeze({
          kind: "expression" as const,
          expression: maybeAwait(
            initializerName,
            initialization.asynchronous,
            initialization.raises,
          ),
        })]
      : []),
    Object.freeze({
      kind: "expression" as const,
      expression: maybeAwait(importedName, function_.asynchronous, function_.raises),
    }),
  ]);
  const bootstrap: MojoFunctionDeclaration | undefined = asynchronousBootstrap
    ? Object.freeze({
        kind: "function",
        name: bootstrapName,
        genericParameters: Object.freeze([]),
        parameters: Object.freeze([]),
        resultType: Object.freeze({ kind: "unit" }),
        asynchronous: true,
        raises: sourceEntryRaises,
        statements: binarySourceBoundaryStatements(sourceBootstrapStatements, sourceEntryRaises),
      })
    : undefined;
  const module: MojoSourceModule = Object.freeze({
    modulePath: Object.freeze([]),
    imports: Object.freeze([
      Object.freeze({
        kind: "symbols" as const,
        modulePath: entry.modulePath,
        symbols: Object.freeze(entryImportSymbols),
      }),
      ...(initialization.runtimeInitializationRequired && !sameInitializationModule
        ? [Object.freeze({
            kind: "symbols" as const,
            modulePath: initializationOwnerDefinition.modulePath,
            symbols: Object.freeze([Object.freeze({
              name: initializationOwner.initializeName,
              alias: initializerName,
            })]),
          })]
        : []),
      ...(asynchronousBootstrap
        ? [Object.freeze({
            kind: "symbols" as const,
            modulePath: Object.freeze(["tsonic_runtime"]),
            symbols: Object.freeze(taskFactories.map((name) => Object.freeze({ name }))),
          })]
        : []),
      ...uniqueModulePaths(program.binaryEpilogues.map((epilogue) => epilogue.modulePath))
        .map((modulePath) => Object.freeze({
          kind: "module" as const,
          modulePath,
        })),
    ]),
    typeAliases: Object.freeze([]),
    declarations: normalizeMojoDeclarations([
      ...(bootstrap === undefined ? [] : [bootstrap]),
      Object.freeze({
        kind: "function" as const,
        name: "main",
        genericParameters: Object.freeze([]),
        parameters: Object.freeze([]),
        resultType: Object.freeze({ kind: "unit" as const }),
        asynchronous: false,
        raises: binaryRaises,
        statements: Object.freeze(asynchronousBootstrap
          ? [
              Object.freeze({
                kind: "expression" as const,
                expression: Object.freeze({
                  kind: "method-call" as const,
                  receiver: Object.freeze({
                    kind: "call" as const,
                    callee: Object.freeze({
                      kind: "path" as const,
                      path: taskFactory(sourceEntryRaises),
                    }),
                    arguments: Object.freeze([Object.freeze({ value: call(bootstrapName) })]),
                  }),
                  name: "wait",
                  arguments: Object.freeze([]),
                }),
              }),
              ...binaryEpilogueStatements(program),
            ]
          : [
              ...binarySourceBoundaryStatements(sourceBootstrapStatements, sourceEntryRaises),
              ...binaryEpilogueStatements(program),
            ]),
      }),
    ]),
  });
  const rootComponent = program.modules.packages.find((package_) => package_.root);
  if (rootComponent === undefined) {
    diagnostics.push(planningDiagnostic(
      "MOJO_ROOT_SOURCE_PACKAGE_MISSING",
      "Binary output has no sealed root source-package component.",
      entry.sourceFile,
    ));
    return undefined;
  }
  return Object.freeze({ componentId: rootComponent.componentId, path: "src/main.mojo", module });
}

function binarySourceBoundaryStatements(
  statements: readonly MojoStatement[],
  raises: boolean,
): readonly MojoStatement[] {
  if (!raises) return statements;
  const errorName = "_entry_error";
  const error = Object.freeze({ kind: "path" as const, path: errorName });
  return Object.freeze([Object.freeze({
    kind: "try" as const,
    statements,
    catches: Object.freeze([Object.freeze({
      name: errorName,
      statements: Object.freeze([Object.freeze({
        kind: "raise" as const,
        expression: Object.freeze({
          kind: "call" as const,
          callee: Object.freeze({ kind: "path" as const, path: "Error" }),
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({
              kind: "call" as const,
              callee: Object.freeze({ kind: "path" as const, path: "String" }),
              arguments: Object.freeze([Object.freeze({ value: error })]),
            }),
          })]),
        }),
      })]),
    })]),
  })]);
}

function binaryEpilogueStatements(program: MojoTargetProgram): readonly MojoStatement[] {
  return Object.freeze(program.binaryEpilogues.map((epilogue) => Object.freeze({
    kind: "expression" as const,
    expression: Object.freeze({
      kind: "call" as const,
      callee: Object.freeze({
        kind: "qualified-path" as const,
        segments: Object.freeze([...epilogue.modulePath, epilogue.name]),
      }),
      arguments: Object.freeze([]),
    }),
  })));
}

function uniqueModulePaths(paths: readonly (readonly string[])[]): readonly (readonly string[])[] {
  const modules = new Map<string, readonly string[]>();
  for (const path of paths) modules.set(path.join("."), Object.freeze([...path]));
  return Object.freeze([...modules.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, path]) => path));
}

function sortedImports(imports: Iterable<MojoImportDeclaration>): readonly MojoImportDeclaration[] {
  return Object.freeze([...imports].sort((left, right) =>
    left.modulePath.join(".").localeCompare(right.modulePath.join("."), "en") ||
    left.kind.localeCompare(right.kind, "en")));
}

function duplicateSourcePaths(sources: readonly MojoOutputSourceFile[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.path)) duplicates.add(source.path);
    seen.add(source.path);
  }
  return Object.freeze([...duplicates].sort((left, right) => left.localeCompare(right, "en")));
}

function planningDiagnostic(
  code: string,
  message: string,
  sourceNode?: import("@tsonic/tsts").Node,
): TargetDiagnostic {
  return Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    ...(sourceNode === undefined ? {} : { sourceNode }),
    evidence: Object.freeze(["target.capability=mojo.backend.output-modules"]),
  });
}
