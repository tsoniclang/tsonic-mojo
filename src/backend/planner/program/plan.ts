import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan, MojoOutputSourceFile } from "../../artifact-model/project/output.js";
import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoImportDeclaration,
  MojoSourceModule,
  MojoStatement,
} from "../../target-ast/index.js";
import {
  createMojoPlanningContext,
  registerMojoModuleImport,
} from "./context.js";
import type {
  MojoOutputPlanningContext,
} from "./context.js";
import type {
  MojoAnalyzedFunction,
  MojoTargetProgram,
} from "../../../analysis/program/model.js";
import { normalizeMojoIdentifier } from "../../../target-model/names/identifiers.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import { planMojoModuleState } from "./module-state.js";
import { planMojoInterface } from "../declarations/interfaces.js";
import {
  planMojoProjectClass,
  planMojoProjectEnum,
  planMojoProjectFunction,
} from "../declarations/project.js";

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
  const packageSources = planPackageInitializers(program, diagnostics);
  sources.push(...packageSources);
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
  return resolvedTargetStage(Object.freeze({
    configuration: program.configuration,
    sources: Object.freeze([...sources].sort((left, right) => left.path.localeCompare(right.path, "en"))),
    runtimePackages: program.runtimePackages,
  }));
}

function planSourceModule(
  program: MojoTargetProgram,
  module: MojoSourceModuleDefinition,
):
  | { readonly kind: "resolved"; readonly source: MojoOutputSourceFile }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const context = createMojoPlanningContext(program, module);
  for (const dependency of module.dependencies) {
    registerMojoModuleImport(context, dependency.target.modulePath);
  }
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
    } else if (context.diagnostics.length === stateDiagnosticCount) {
      context.diagnostics.push(planningDiagnostic(
        "MOJO_MODULE_STATE_NOT_PLANNED",
        `Source module '${module.relativeSourcePath}' has no exact sealed module-state plan.`,
        module.sourceFile,
      ));
    }
  }
  for (const declaration of program.declarations) {
    if (program.modules.forSourceFile(declaration.sourceFile)?.id !== module.id) continue;
    if (declaration.kind === "class") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planMojoProjectClass(declaration, context);
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
      declarations.push(...planMojoInterface(declaration, context));
      continue;
    }
    const diagnosticCount = context.diagnostics.length;
    const planned = planMojoProjectFunction(declaration, context);
    if (planned !== undefined) {
      declarations.push(planned);
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
  return Object.freeze({
    kind: "resolved",
    source: Object.freeze({
      path: module.artifactPath,
      module: Object.freeze({
        modulePath: module.modulePath,
        imports: sortedImports(context.imports.values()),
        declarations: Object.freeze([...declarations, ...context.syntheticDeclarations]),
      }),
    }),
  });
}

function planPackageInitializers(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
): readonly MojoOutputSourceFile[] {
  const sources: MojoOutputSourceFile[] = [];
  for (const package_ of program.modules.packages) {
    for (const modulePath of package_.moduleDirectories) {
      const imports: MojoImportDeclaration[] = [];
      if (package_.root && modulePath.length === 1) {
        imports.push(...entryExportImports(program, diagnostics));
      }
      sources.push(Object.freeze({
        path: `src/${modulePath.join("/")}/__init__.mojo`,
        module: Object.freeze({
          modulePath,
          imports: Object.freeze(imports),
          declarations: Object.freeze([]),
        }),
      }));
    }
  }
  return Object.freeze(sources);
}

function entryExportImports(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
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

function planBinaryEntry(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
): MojoOutputSourceFile | undefined {
  const entry = program.modules.entryPoint;
  const exportedMain = entry.exports.find((exported) => exported.exportName === "main");
  const function_ = exportedMain === undefined
    ? undefined
    : program.declarations.find((declaration): declaration is MojoAnalyzedFunction =>
      declaration.kind === "function" && declaration.declaration === exportedMain.declaration);
  if (exportedMain === undefined || function_ === undefined ||
    function_.parameters.length !== 0 || function_.typeParameters.length !== 0 ||
    function_.resultType.kind !== "unit") {
    diagnostics.push(planningDiagnostic(
      "MOJO_BINARY_ENTRYPOINT_UNSUPPORTED",
      "Binary output requires the configured entry module to export a non-generic 'main' function with no parameters and a void result.",
      entry.sourceFile,
    ));
    return undefined;
  }
  const importedName = "__tsonic_entry";
  const analyzedEntry = program.queries.moduleForId(entry.id);
  if (analyzedEntry === undefined) {
    diagnostics.push(planningDiagnostic(
      "MOJO_BINARY_ENTRY_MODULE_ANALYSIS_MISSING",
      "Binary entry module has no sealed Mojo module analysis.",
      entry.sourceFile,
    ));
    return undefined;
  }
  const initializerName = "__tsonic_initialize_entry";
  const importedSymbols = [
    Object.freeze({ name: function_.name, alias: importedName }),
    ...(analyzedEntry.runtimeInitializationRequired
      ? [Object.freeze({ name: analyzedEntry.initializeName, alias: initializerName })]
      : []),
  ];
  const asynchronousBootstrap = function_.asynchronous || analyzedEntry.asynchronous;
  const binaryRaises = function_.raises || analyzedEntry.raises ||
    program.binaryEpilogues.some((epilogue) => epilogue.raises === true);
  const bootstrapName = "__tsonic_async_entry";
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
    ...(asynchronousBootstrap ? [taskFactory(function_.raises || analyzedEntry.raises)] : []),
    ...(analyzedEntry.runtimeInitializationRequired && analyzedEntry.asynchronous
      ? [taskFactory(analyzedEntry.raises)]
      : []),
    ...(function_.asynchronous ? [taskFactory(function_.raises)] : []),
  ])];
  const bootstrap: MojoFunctionDeclaration | undefined = asynchronousBootstrap
    ? Object.freeze({
        kind: "function",
        name: bootstrapName,
        genericParameters: Object.freeze([]),
        parameters: Object.freeze([]),
        resultType: Object.freeze({ kind: "unit" }),
        asynchronous: true,
        raises: function_.raises || analyzedEntry.raises,
        statements: Object.freeze([
          ...(analyzedEntry.runtimeInitializationRequired
            ? [Object.freeze({
                kind: "expression" as const,
                expression: maybeAwait(initializerName, analyzedEntry.asynchronous, analyzedEntry.raises),
              })]
            : []),
          Object.freeze({
            kind: "expression" as const,
            expression: maybeAwait(importedName, function_.asynchronous, function_.raises),
          }),
        ]),
      })
    : undefined;
  const module: MojoSourceModule = Object.freeze({
    modulePath: Object.freeze([]),
    imports: Object.freeze([
      Object.freeze({
        kind: "symbols" as const,
        modulePath: entry.modulePath,
        symbols: Object.freeze(importedSymbols),
      }),
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
    declarations: Object.freeze([
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
                      path: taskFactory(function_.raises || analyzedEntry.raises),
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
              ...(analyzedEntry.runtimeInitializationRequired
                ? [Object.freeze({
                    kind: "expression" as const,
                    expression: call(initializerName),
                  })]
                : []),
              Object.freeze({
                kind: "expression" as const,
                expression: call(importedName),
              }),
              ...binaryEpilogueStatements(program),
            ]),
      }),
    ]),
  });
  return Object.freeze({ path: "src/main.mojo", module });
}

function binaryEpilogueStatements(program: MojoTargetProgram): readonly MojoStatement[] {
  return Object.freeze(program.binaryEpilogues.map((epilogue) => Object.freeze({
    kind: "expression" as const,
    expression: Object.freeze({
      kind: "call" as const,
      callee: Object.freeze({
        kind: "path" as const,
        path: [...epilogue.modulePath, epilogue.name].join("."),
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
