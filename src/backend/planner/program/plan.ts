import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan, MojoOutputSourceFile } from "../../artifact-model/project/output.js";
import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoImportDeclaration,
  MojoSourceModule,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  createMojoPlanningContext,
  registerMojoModuleImport,
} from "./context.js";
import type {
  MojoOutputPlanningContext,
  MojoPlanningContext,
} from "./context.js";
import { planMojoExpression } from "../expressions/value.js";
import { planMojoFunctionStatements } from "../statements/structured.js";
import { registerMojoTypeImports } from "../types/render.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoTargetProgram,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { normalizeMojoIdentifier } from "../../../target-model/names/identifiers.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import { planMojoModuleState } from "./module-state.js";
import { planMojoInterface } from "../declarations/interfaces.js";

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
  const analyzedModule = program.queries.moduleForSourceFile(module.sourceFile);
  if (analyzedModule === undefined) {
    context.diagnostics.push(planningDiagnostic(
      "MOJO_ANALYZED_MODULE_MISSING",
      `Source module '${module.relativeSourcePath}' has no sealed target analysis.`,
      module.sourceFile,
    ));
  } else {
    const state = planMojoModuleState(program, module, analyzedModule, context);
    if (state !== undefined) declarations.push(...state);
  }
  for (const declaration of program.declarations) {
    if (declaration.sourceFile !== module.sourceFile) continue;
    if (declaration.kind === "class") {
      const planned = planClass(declaration, context);
      if (planned !== undefined) declarations.push(...planned);
      continue;
    }
    if (declaration.kind === "enum") {
      declarations.push(planEnum(declaration));
      continue;
    }
    if (declaration.kind === "interface") {
      declarations.push(...planMojoInterface(declaration, context));
      continue;
    }
    const planned = planFunction(declaration, context);
    if (planned !== undefined) declarations.push(planned);
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
        declarations: Object.freeze(declarations),
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
  const analyzedEntry = program.queries.moduleForSourceFile(entry.sourceFile);
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
  const module: MojoSourceModule = Object.freeze({
    modulePath: Object.freeze([]),
    imports: Object.freeze([
      Object.freeze({
        kind: "symbols" as const,
        modulePath: entry.modulePath,
        symbols: Object.freeze(importedSymbols),
      }),
      ...(function_.asynchronous
        ? [Object.freeze({
            kind: "symbols" as const,
            modulePath: Object.freeze(["tsonic_runtime"]),
            symbols: Object.freeze([Object.freeze({
              name: function_.raises ? "create_raising_task" : "create_task",
            })]),
          })]
        : []),
    ]),
    declarations: Object.freeze([Object.freeze({
      kind: "function" as const,
      name: "main",
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([]),
      resultType: Object.freeze({ kind: "unit" as const }),
      asynchronous: false,
      raises: function_.raises || analyzedEntry.raises,
      statements: Object.freeze([
        ...(analyzedEntry.runtimeInitializationRequired
          ? [Object.freeze({
              kind: "expression" as const,
              expression: Object.freeze({
                kind: "call" as const,
                callee: Object.freeze({ kind: "path" as const, path: initializerName }),
                arguments: Object.freeze([]),
              }),
            })]
          : []),
        Object.freeze({
          kind: "expression" as const,
          expression: function_.asynchronous
            ? Object.freeze({
                kind: "method-call" as const,
                receiver: Object.freeze({
                  kind: "call" as const,
                  callee: Object.freeze({
                    kind: "path" as const,
                    path: function_.raises ? "create_raising_task" : "create_task",
                  }),
                  arguments: Object.freeze([Object.freeze({
                    value: Object.freeze({
                      kind: "call" as const,
                      callee: Object.freeze({ kind: "path" as const, path: importedName }),
                      arguments: Object.freeze([]),
                    }),
                  })]),
                }),
                name: "wait",
                arguments: Object.freeze([]),
              })
            : Object.freeze({
                kind: "call" as const,
                callee: Object.freeze({ kind: "path" as const, path: importedName }),
                arguments: Object.freeze([]),
              }),
        }),
      ]),
    })]),
  });
  return Object.freeze({ path: "src/main.mojo", module });
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

function planFunction(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  self?: MojoFunctionDeclaration["self"],
): MojoFunctionDeclaration | undefined {
  for (const parameter of function_.parameters) registerMojoTypeImports(parameter.type, context);
  registerMojoTypeImports(function_.resultType, context);
  const statements = planMojoFunctionStatements(function_, context);
  if (statements === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: function_.name,
    genericParameters: genericParameters(function_),
    parameters: Object.freeze(function_.parameters.map((parameter) => Object.freeze({
      name: parameter.name,
      type: parameter.type,
      convention: parameter.convention,
      variadic: parameter.rest,
      ...(parameter.optional && parameter.initializer === undefined
        ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
        : {}),
    }))),
    resultType: function_.resultType,
    asynchronous: function_.asynchronous,
    raises: function_.raises,
    statements,
    ...(self === undefined ? {} : { self }),
  });
}

function planClass(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] | undefined {
  const genericParameters_ = genericParameters(class_);
  const genericArguments = class_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    type: Object.freeze({ kind: "type-parameter" as const, name: parameter.name }),
  }));
  const stateType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: `${class_.targetType.kind === "target-named" ? class_.targetType.id : class_.name}:state`,
    modulePath: Object.freeze([]),
    name: class_.stateName,
    ...(genericArguments.length === 0 ? {} : { genericArguments: Object.freeze(genericArguments) }),
  });
  const arcType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: "mojo.std.memory.ArcPointer",
    modulePath: Object.freeze(["std", "memory"]),
    name: "ArcPointer",
    genericArguments: Object.freeze([{ kind: "type" as const, type: stateType }]),
  });
  registerMojoTypeImports(arcType, context);
  for (const field of class_.fields) registerMojoTypeImports(field.type, context);
  const state: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.stateName,
    genericParameters: genericParameters_,
    conformances: Object.freeze([]),
    fields: Object.freeze(class_.fields.map((field) => Object.freeze({
      name: field.name,
      type: field.type,
      compileTime: false,
    }))),
    methods: Object.freeze([]),
    decorators: Object.freeze(["fieldwise_init"]),
  });
  const sourceConstructor = class_.constructors[0];
  const fieldArguments = class_.fields.map((field) => {
    const value = planMojoExpression(field.initializer, context, field.type);
    return value === undefined ? undefined : Object.freeze({ value });
  });
  if (fieldArguments.some((argument) => argument === undefined)) return undefined;
  const stateConstruction = Object.freeze({
    kind: "construct" as const,
    type: stateType,
    arguments: Object.freeze(fieldArguments as NonNullable<typeof fieldArguments[number]>[]),
  });
  const arcConstruction = Object.freeze({
    kind: "construct" as const,
    type: arcType,
    arguments: Object.freeze([{ value: stateConstruction }]),
  });
  const initializeState: MojoStatement = Object.freeze({
    kind: "assignment",
    operator: "=",
    left: Object.freeze({
      kind: "member",
      receiver: Object.freeze({ kind: "path", path: "self" }),
      name: "_state",
    }),
    right: arcConstruction,
  });
  let constructorStatements: readonly MojoStatement[] = Object.freeze([]);
  if (sourceConstructor !== undefined) {
    const planned = planMojoFunctionStatements(sourceConstructor, context);
    if (planned === undefined) return undefined;
    constructorStatements = planned;
  }
  const constructor: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze((sourceConstructor?.parameters ?? []).map((parameter) => Object.freeze({
      name: parameter.name,
      type: parameter.type,
      convention: parameter.convention,
      variadic: parameter.rest,
      ...(parameter.optional && parameter.initializer === undefined
        ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
        : {}),
    }))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: sourceConstructor?.raises === true,
    self: "out self",
    statements: Object.freeze([initializeState, ...constructorStatements]),
  });
  const methods: MojoFunctionDeclaration[] = [constructor];
  for (const method of class_.methods) {
    const planned = planFunction(method, context, method.static === true ? undefined : "self");
    if (planned === undefined) return undefined;
    methods.push(planned);
  }
  const wrapper: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.name,
    genericParameters: genericParameters_,
    conformances: Object.freeze([Object.freeze({
      kind: "target-named",
      id: "mojo.builtin.Copyable",
      modulePath: Object.freeze([]),
      name: "Copyable",
    })]),
    fields: Object.freeze([Object.freeze({
      name: "_state",
      type: arcType,
      compileTime: false,
    })]),
    methods: Object.freeze(methods),
  });
  return Object.freeze([state, wrapper]);
}

function planEnum(enum_: MojoAnalyzedEnum): MojoStructDeclaration {
  const enumType = enum_.targetType;
  const int64Type: MojoTargetTypeRef = Object.freeze({
    kind: "source-primitive",
    name: "int64",
  });
  return Object.freeze({
    kind: "struct",
    name: enum_.name,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.Equatable",
        modulePath: Object.freeze([]),
        name: "Equatable",
      }),
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.TrivialRegisterPassable",
        modulePath: Object.freeze([]),
        name: "TrivialRegisterPassable",
      }),
    ]),
    fields: Object.freeze([
      Object.freeze({
        name: "value",
        type: int64Type,
        compileTime: false,
      }),
      ...enum_.members.map((member) => Object.freeze({
        name: member.name,
        type: enumType,
        compileTime: true,
        initializer: Object.freeze({
          kind: "construct" as const,
          type: enumType,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "number-literal" as const, text: String(member.value) }),
          })]),
        }),
      })),
    ]),
    methods: Object.freeze([]),
    decorators: Object.freeze(["fieldwise_init"]),
  });
}

function genericParameters(
  declaration: Pick<MojoAnalyzedFunction | MojoAnalyzedClass | MojoAnalyzedInterface, "typeParameters">,
) {
  return Object.freeze(declaration.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    name: parameter.name,
    position: "positional-or-keyword" as const,
    variadic: false,
    constraints: parameter.constraints,
  })));
}
