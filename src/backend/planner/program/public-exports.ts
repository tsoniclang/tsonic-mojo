import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoTargetProgram,
} from "../../../analysis/program/model.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import {
  closeMojoErrorType,
  mojoNativeErrorType,
} from "../../../target-model/types/error-domains.js";
import { normalizeMojoIdentifier } from "../../../target-model/names/identifiers.js";
import type {
  MojoTargetCallableParameter,
  MojoTargetTypeRef,
} from "../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoStatement,
} from "../../target-ast/index.js";
import { mojoModuleBindingRead } from "../bindings/module-bindings.js";
import { adaptMojoValueErrorDomain } from "../expressions/error-domains.js";
import { mojoValue } from "../expressions/value-plan.js";
import {
  appendMojoPlanningDiagnostic,
  registerMojoModuleImport,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import { registerMojoTypeImports } from "../types/render.js";

const unitType: MojoTargetTypeRef = Object.freeze({ kind: "unit" });

export function planMojoPublicModuleExports(
  program: MojoTargetProgram,
  definition: MojoSourceModuleDefinition,
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const bindings = new Map<import("@tsonic/tsts").Node, MojoAnalyzedModuleBinding>();
  for (const exported of program.modules.entryPoint.exports) {
    if (program.modules.forSourceFile(exported.sourceFile)?.id !== definition.id) continue;
    const binding = program.queries.moduleBinding(exported.declaration);
    if (binding?.storage === "cell") bindings.set(binding.declaration, binding);
  }
  if (bindings.size === 0) return Object.freeze([]);
  if (module.asynchronous) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ASYNC_PUBLIC_BINDING_MODULE_UNSUPPORTED",
      "A public runtime binding cannot synchronously expose an asynchronously initialized source module.",
      module.sourceFile,
    );
    return undefined;
  }
  const declarations: MojoFunctionDeclaration[] = [];
  for (const binding of [...bindings.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en"))) {
    const declaration = planPublicCallableBinding(binding, module, context);
    if (declaration === undefined) return undefined;
    declarations.push(declaration);
  }
  return Object.freeze(declarations);
}

function planPublicCallableBinding(
  binding: MojoAnalyzedModuleBinding,
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (binding.type.kind !== "callable") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PUBLIC_RUNTIME_VALUE_ABI_UNSUPPORTED",
      `Public runtime binding '${binding.sourceName}' requires an explicit Mojo library value ABI.`,
      binding.declaration,
    );
    return undefined;
  }
  const callableType = binding.type;
  const parameterNames = allocateParameterNames(callableType.parameters);
  const parameters = callableType.parameters.map((parameter, index) =>
    publicParameter(parameter, parameterNames[index]!, context));
  if (parameters.some((parameter) => parameter === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PUBLIC_CALLABLE_PARAMETER_ABI_UNSUPPORTED",
      `Public callable '${binding.sourceName}' has a parameter that cannot be represented exactly by Mojo's library ABI.`,
      binding.declaration,
    );
    return undefined;
  }
  const moduleErrorType = module.raises
    ? module.errorType ?? mojoNativeErrorType()
    : undefined;
  const callableErrorType = callableType.raises
    ? callableType.errorType ?? mojoNativeErrorType()
    : undefined;
  const errorType = closeMojoErrorType(Object.freeze([
    ...(moduleErrorType === undefined ? [] : [moduleErrorType]),
    ...(callableErrorType === undefined ? [] : [callableErrorType]),
  ]));
  if (errorType !== undefined) registerMojoTypeImports(errorType, context);
  registerMojoTypeImports(callableType, context);
  const statements: MojoStatement[] = [];
  if (module.runtimeInitializationRequired) {
    const initialization = adaptMojoValueErrorDomain(
      mojoValue(Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: module.initializeName }),
        arguments: Object.freeze([]),
      })),
      unitType,
      moduleErrorType,
      errorType,
      binding.declaration,
      context,
    );
    if (initialization === undefined) return undefined;
    statements.push(...initialization.before);
    if (!isUnitValue(initialization.value)) {
      statements.push(Object.freeze({ kind: "expression", expression: initialization.value }));
    }
  }
  const callable = mojoModuleBindingRead(binding, context);
  if (callable === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PUBLIC_CALLABLE_STORAGE_MISSING",
      `Public callable '${binding.sourceName}' has no exact initialized module storage.`,
      binding.declaration,
    );
    return undefined;
  }
  const arguments_ = callableType.parameters.map((parameter, index) =>
    publicCallableArgument(parameter, parameterNames[index]!, context));
  if (arguments_.some((argument) => argument === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PUBLIC_CALLABLE_ARGUMENT_ABI_UNSUPPORTED",
      `Public callable '${binding.sourceName}' cannot close its exact erased-callable argument tuple.`,
      binding.declaration,
    );
    return undefined;
  }
  const call = Object.freeze({
    kind: "method-call" as const,
    receiver: callable,
    name: "call",
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({
        kind: "tuple" as const,
        elements: Object.freeze(arguments_ as MojoExpression[]),
      }),
    })]),
  });
  const result = adaptMojoValueErrorDomain(
    mojoValue(call),
    callableType.result,
    callableErrorType,
    errorType,
    binding.declaration,
    context,
  );
  if (result === undefined) return undefined;
  statements.push(...result.before);
  if (callableType.result.kind === "unit") {
    if (!isUnitValue(result.value)) {
      statements.push(Object.freeze({ kind: "expression", expression: result.value }));
    }
    statements.push(Object.freeze({ kind: "return" }));
  } else {
    statements.push(Object.freeze({ kind: "return", expression: result.value }));
  }
  return Object.freeze({
    kind: "function",
    name: binding.name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(parameters as MojoParameter[]),
    resultType: callableType.result,
    asynchronous: false,
    raises: errorType !== undefined,
    ...(errorType === undefined ? {} : { errorType }),
    statements: Object.freeze(statements),
  });
}

function publicParameter(
  parameter: MojoTargetCallableParameter,
  name: string,
  context: MojoPlanningContext,
): MojoParameter | undefined {
  const omissionKind = parameter.omissionKind ?? "required";
  const type = omissionKind === "rest" ? collectionElement(parameter.type) : parameter.type;
  if (type === undefined) return undefined;
  registerMojoTypeImports(type, context);
  return Object.freeze({
    name,
    type,
    convention: parameter.convention,
    ...(omissionKind === "rest" ? { variadic: true } : {}),
    ...(omissionKind === "undefined" || omissionKind === "initializer"
      ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
      : {}),
  });
}

function publicCallableArgument(
  parameter: MojoTargetCallableParameter,
  name: string,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const omissionKind = parameter.omissionKind ?? "required";
  const path: MojoExpression = Object.freeze({ kind: "path", path: name });
  let value = omissionKind === "rest"
    ? materializeRestArgument(parameter.type, path, context)
    : path;
  if (value === undefined) return undefined;
  if (parameter.passing === "consume") {
    value = Object.freeze({ kind: "consume", expression: value });
  }
  return value;
}

function materializeRestArgument(
  type: MojoTargetTypeRef,
  value: MojoExpression,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (type.kind === "list") {
    registerMojoTypeImports(type, context);
    return Object.freeze({
      kind: "construct",
      type,
      arguments: Object.freeze([Object.freeze({ value })]),
    });
  }
  if (type.kind !== "target-named" || type.id !== "tsonic.mojo.js.JsArray") return undefined;
  const element = collectionElement(type);
  if (element === undefined) return undefined;
  registerMojoModuleImport(context, Object.freeze(["tsonic_js"]));
  const listType: MojoTargetTypeRef = Object.freeze({ kind: "list", element });
  registerMojoTypeImports(listType, context);
  registerMojoTypeImports(type, context);
  return Object.freeze({
    kind: "construct",
    type,
    arguments: Object.freeze([Object.freeze({ value: Object.freeze({
      kind: "construct",
      type: listType,
      arguments: Object.freeze([Object.freeze({ value })]),
    }) })]),
  });
}

function collectionElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (type.kind === "list") return type.element;
  if (type.kind !== "target-named" || type.id !== "tsonic.mojo.js.JsArray") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

function allocateParameterNames(parameters: readonly MojoTargetCallableParameter[]): readonly string[] {
  const used = new Set<string>();
  return Object.freeze(parameters.map((parameter, index) => {
    const base = normalizeMojoIdentifier(parameter.name ?? `argument${index + 1}`);
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    return name;
  }));
}

function isUnitValue(expression: MojoExpression): boolean {
  return expression.kind === "tuple" && expression.elements.length === 0;
}
