import type {
  ProviderExportDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";
import type {
  MojoCompilerAlias,
  MojoCompilerFunction,
} from "../model/model.js";
import type {
  MojoProviderOperationDefinition,
  MojoProviderTypeDefinition,
} from "../../packages/model.js";
import type { MojoProviderTargetArgument } from "../../../target-model/types/model.js";
import { projectMojoPassingMode } from "./call-conventions.js";
import {
  projectMojoCompilerType,
  projectMojoGenericParameters,
  sourceVisibleMojoGenericParameters,
} from "./types.js";
import type { MojoCompilerTypeProjectionContext } from "./types.js";

export function projectAlias(
  declaration: MojoCompilerAlias,
  sourceName: string,
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
  types: MojoProviderTypeDefinition[],
): ProviderExportDeclaration {
  const exportId = sourceExportId(context);
  if (declaration.category === "type") {
    if (declaration.targetType === undefined) {
      throw new Error(`Mojo type alias '${declaration.name}' has no exact target type.`);
    }
    const projected = projectMojoCompilerType(declaration.targetType, context);
    types.push(Object.freeze({
      exportId,
      sourceGenericParameters: Object.freeze(sourceVisibleMojoGenericParameters(declaration.genericParameters).map((parameter) =>
        Object.freeze({ targetName: parameter.name, targetKind: parameter.kind, variadic: parameter.variadic }))),
      targetType: projected.target,
    }));
    return Object.freeze({
      id: exportId,
      name: declaration.name,
      ...(sourceName === declaration.name ? {} : { exportName: sourceName }),
      kind: "type",
      type: projected.source,
      ...(declaration.genericParameters.length === 0
        ? {}
        : { typeParameters: projectMojoGenericParameters(declaration.genericParameters, context) }),
      ...documentation(declaration.documentation),
    });
  }
  if (declaration.valueType === undefined) {
    throw new Error(`Mojo value alias '${declaration.name}' has no compiler-retained value type.`);
  }
  const projected = projectMojoCompilerType(declaration.valueType, context);
  operations.push(Object.freeze({
    exportId,
    operationKind: "property",
    target: Object.freeze({
      kind: "constant",
      modulePath: Object.freeze([context.package.packageName, ...context.modulePath]),
      name: declaration.name,
    }),
    resultType: projected.target,
  }));
  return Object.freeze({
    id: exportId,
    name: declaration.name,
    ...(sourceName === declaration.name ? {} : { exportName: sourceName }),
    kind: "value",
    type: projected.source,
    ...documentation(declaration.documentation),
  });
}

export function projectFunctionSignature(
  function_: MojoCompilerFunction,
  context: MojoCompilerTypeProjectionContext,
  memberId: string | undefined,
): {
  readonly signature: ProviderSignatureDeclaration;
  readonly targetArguments: readonly MojoProviderTargetArgument[];
  readonly parameterTargets: readonly import("../../../target-model/types/model.js").MojoTargetTypeRef[];
  readonly resultTarget: import("../../../target-model/types/model.js").MojoTargetTypeRef;
} {
  const sourceArguments = function_.arguments.filter(({ name }) => name !== "self");
  const projectedArguments = sourceArguments.map((argument) => ({
    argument,
    type: projectMojoCompilerType(argument.type, context),
  }));
  const result = function_.result === undefined
    ? { source: Object.freeze({ kind: "void" as const }), target: Object.freeze({ kind: "unit" as const }) }
    : projectMojoCompilerType(function_.result, context);
  const sourceResult = function_.asynchronous
    ? Object.freeze({
        kind: "source-global" as const,
        name: "Promise",
        typeArguments: Object.freeze([result.source]),
      })
    : result.source;
  const targetResult = function_.asynchronous
    ? Object.freeze({ kind: "future" as const, domain: "native" as const, output: result.target })
    : result.target;
  const parameters: ProviderParameterDeclaration[] = projectedArguments.map(({ argument, type }) =>
    Object.freeze({
      name: argument.name,
      type: type.source,
      passingMode: projectMojoPassingMode(argument.convention),
      ...(argument.defaultValue === undefined ? {} : { optional: true }),
      ...(argument.variadic ? { rest: true } : {}),
    }));
  return Object.freeze({
    signature: Object.freeze({
      id: memberId === undefined
        ? function_.identity
        : `${memberId}:${function_.identity.split(":").slice(-1)[0]}`,
      name: function_.name,
      parameters: Object.freeze(parameters),
      returnType: sourceResult,
      ...(function_.genericParameters.length === 0
        ? {}
        : { typeParameters: projectMojoGenericParameters(function_.genericParameters, context) }),
      ...documentation(function_.documentation),
    }),
    targetArguments: Object.freeze(projectedArguments.map(({ argument }): MojoProviderTargetArgument =>
      Object.freeze({
        convention: argument.convention,
        position: argument.position,
        ...(argument.position === "keyword" ? { nativeName: argument.name } : {}),
        ...(argument.variadic ? { variadic: true } : {}),
      }))),
    parameterTargets: Object.freeze(projectedArguments.map(({ type }) => type.target)),
    resultTarget: targetResult,
  });
}

export function sourceExportId(context: MojoCompilerTypeProjectionContext): string {
  return `${context.source.providerModuleId}::export:${context.source.exportName}`;
}

export function groupByName<T extends { readonly name: string }>(values: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const group = result.get(value.name) ?? [];
    group.push(value);
    result.set(value.name, group);
  }
  return result;
}

export function canonicalExportMappings(
  mappings: readonly { readonly declarationName: string; readonly exportName: string }[],
): readonly { readonly declarationName: string; readonly exportName: string }[] {
  const declarations = new Set<string>();
  const exports = new Set<string>();
  for (const mapping of mappings) {
    if (declarations.has(mapping.declarationName)) {
      throw new Error(`Mojo projection duplicates declaration '${mapping.declarationName}'.`);
    }
    if (exports.has(mapping.exportName)) {
      throw new Error(`Mojo projection duplicates public export '${mapping.exportName}'.`);
    }
    declarations.add(mapping.declarationName);
    exports.add(mapping.exportName);
  }
  return Object.freeze([...mappings].sort((left, right) => compareText(left.exportName, right.exportName)));
}

export function firstDocumentation(values: readonly { readonly documentation?: string }[]) {
  return documentation(values.find(({ documentation: value }) => value !== undefined)?.documentation);
}

export function documentation(value: string | undefined): { readonly documentation?: string } {
  return value === undefined || value.length === 0 ? {} : { documentation: value };
}

export function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
