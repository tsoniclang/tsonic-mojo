import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoOutputSourceFile } from "../../artifact-model/project/output.js";
import type {
  MojoFunctionDeclaration,
  MojoSourceModule,
  MojoStatement,
} from "../../target-ast/index.js";
import type { MojoTargetProgram } from "../../../analysis/program/model.js";
import { normalizeMojoDeclarations } from "../../normalization/index.js";
import { mojoOutputPlanningDiagnostic } from "./plan-support.js";

export function planBinaryEntry(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
): MojoOutputSourceFile | undefined {
  const entry = program.modules.entryPoint;
  const function_ = program.binaryEntry;
  if (function_ === undefined) {
    diagnostics.push(mojoOutputPlanningDiagnostic(
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
    diagnostics.push(mojoOutputPlanningDiagnostic(
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
    diagnostics.push(mojoOutputPlanningDiagnostic(
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

