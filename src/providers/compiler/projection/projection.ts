import type {
  ProviderExportDeclaration,
  ProviderImportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";
import { projectMojoPassingMode } from "./call-conventions.js";
import type {
  MojoCompilerAlias,
  MojoCompilerFunction,
  MojoCompilerModuleModel,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
  MojoCompilerStruct,
  MojoCompilerTrait,
  MojoCompilerTypeDeclaration,
} from "../model/model.js";
import type {
  MojoProviderOperationDefinition,
  MojoProviderTypeDefinition,
} from "../../packages/model.js";
import type { MojoProviderTargetArgument } from "../../../target-model/provider/model.js";
import type { MojoCompilerProviderProjection } from "./model.js";
import {
  projectMojoCompilerType,
  projectMojoGenericParameters,
  projectMojoTargetGenericParameters,
} from "./types.js";
import type { MojoCompilerTypeProjectionContext } from "./types.js";

export function projectMojoCompilerModule(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleModel,
  options: {
    readonly providerModuleId: string;
    readonly moduleSpecifier: string;
    readonly exports: readonly {
      readonly declarationName: string;
      readonly exportName: string;
    }[];
  },
): MojoCompilerProviderProjection {
  if (module.packageId !== package_.id || module.packageVersion !== package_.version ||
    package_.modules.every((candidate) => !samePath(candidate.modulePath, module.modulePath))) {
    throw new Error(`Mojo compiler module '${module.moduleIdentity}' does not match its physical package identity.`);
  }
  const imports = new Map<string, Set<string>>();
  const operations: MojoProviderOperationDefinition[] = [];
  const types: MojoProviderTypeDefinition[] = [];
  const baseContext: Omit<MojoCompilerTypeProjectionContext, "source"> = {
    snapshot,
    package: package_,
    modulePath: module.modulePath,
    localDeclarations: new Set(module.availableExports
      .filter(({ kind }) => kind !== "function")
      .map(({ name }) => name)),
    imports,
  };
  const available = new Set(module.availableExports.map(({ name }) => name));
  const mappings = canonicalExportMappings(options.exports);
  for (const { declarationName } of mappings) {
    if (!available.has(declarationName)) {
      throw new Error(`Mojo module has no exported declaration '${declarationName}'.`);
    }
  }
  const exports: ProviderExportDeclaration[] = [];
  const functionsByName = groupByName(module.functions);
  const declarationsByName = new Map(module.declarations.map((declaration) =>
    [declaration.name, declaration] as const));
  for (const mapping of mappings) {
    const context: MojoCompilerTypeProjectionContext = {
      ...baseContext,
      source: Object.freeze({
        providerModuleId: options.providerModuleId,
        moduleSpecifier: options.moduleSpecifier,
        exportName: mapping.exportName,
      }),
    };
    const functions = functionsByName.get(mapping.declarationName);
    const declaration = declarationsByName.get(mapping.declarationName);
    if ((functions === undefined) === (declaration === undefined)) {
      throw new Error(`Mojo export '${mapping.declarationName}' has no singular declaration category.`);
    }
    exports.push(functions === undefined
      ? projectTypeDeclaration(declaration!, mapping.exportName, context, operations, types)
      : projectFunctionExport(mapping.declarationName, mapping.exportName, functions, context, operations));
  }
  imports.delete(options.moduleSpecifier);
  const declarationImports: ProviderImportDeclaration[] = [...imports.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([moduleSpecifier, names]) => Object.freeze({
      moduleSpecifier,
      namedImports: Object.freeze([...names].sort(compareText)
        .map((exportedName) => Object.freeze({ exportedName }))),
    }));
  return Object.freeze({
    declarationModel: Object.freeze({
      moduleSpecifier: options.moduleSpecifier,
      providerModuleId: options.providerModuleId,
      ...(declarationImports.length === 0 ? {} : { imports: Object.freeze(declarationImports) }),
      exports: Object.freeze(exports.sort((left, right) => compareText(left.name, right.name))),
    }),
    operations: Object.freeze(operations),
    types: Object.freeze(types),
  });
}

function projectFunctionExport(
  name: string,
  sourceName: string,
  functions: readonly MojoCompilerFunction[],
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
): ProviderExportDeclaration {
  const exportId = sourceExportId(context);
  const signatures = functions.map((function_) => {
    const projected = projectFunctionSignature(function_, context, undefined);
    operations.push(Object.freeze({
      exportId,
      signatureId: projected.signature.id,
      operationKind: "call",
      target: Object.freeze({
        kind: "function-call",
        modulePath: Object.freeze([context.package.packageName, ...context.modulePath]),
        name,
        ...(function_.genericParameters.length === 0
          ? {}
          : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
        arguments: projected.targetArguments,
      }),
      resultType: projected.resultTarget,
      parameterTypes: projected.parameterTargets,
      ...(function_.raises ? { raises: true } : {}),
    }));
    return projected.signature;
  });
  return Object.freeze({
    id: exportId,
    name,
    ...(sourceName === name ? {} : { exportName: sourceName }),
    kind: "function",
    signatures: Object.freeze(signatures),
    ...firstDocumentation(functions),
  });
}

function projectTypeDeclaration(
  declaration: MojoCompilerTypeDeclaration,
  sourceName: string,
  parentContext: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
  types: MojoProviderTypeDefinition[],
): ProviderExportDeclaration {
  if (declaration.kind === "alias") {
    return projectAlias(declaration, sourceName, parentContext, operations, types);
  }
  const exportId = sourceExportId(parentContext);
  const context: MojoCompilerTypeProjectionContext = {
    ...parentContext,
    owner: {
      name: declaration.name,
      sourceName,
      exportId,
      genericParameters: declaration.kind === "struct" ? declaration.genericParameters : Object.freeze([]),
    },
  };
  const typeParameters = declaration.kind === "struct"
    ? projectMojoGenericParameters(declaration.genericParameters, context)
    : Object.freeze([]);
  const projectedConformances = declaration.parentTraits.map((trait) => {
    const projected = projectMojoCompilerType({
        kind: "named",
        name: trait.name,
        ...(trait.path === undefined ? {} : { path: trait.path }),
        arguments: Object.freeze([]),
      }, context);
    return Object.freeze({ trait, projected });
  });
  const heritage = projectedConformances
    .filter(({ trait }) => trait.condition === undefined)
    .map(({ projected }) => Object.freeze({
      kind: declaration.kind === "struct" ? "implements" as const : "extends" as const,
      type: projected.source,
    }));
  const members = declaration.kind === "struct"
    ? projectStructMembers(declaration, exportId, context, operations)
    : projectTraitMembers(declaration, exportId, context, operations);
  const ownerType = projectMojoCompilerType({
    kind: "named",
    name: declaration.name,
    arguments: declaration.kind === "struct"
      ? declaration.genericParameters.map((parameter) => parameter.kind === "type"
          ? Object.freeze({ kind: "type" as const, type: Object.freeze({ kind: "type-parameter" as const, name: parameter.name }) })
          : Object.freeze({ kind: "value" as const, expression: parameter.name }))
      : Object.freeze([]),
  }, context);
  types.push(Object.freeze({
    exportId,
    sourceGenericParameters: Object.freeze((declaration.kind === "struct"
      ? declaration.genericParameters
      : []).map((parameter) => Object.freeze({
        targetName: parameter.name,
        targetKind: parameter.kind,
      }))),
    targetType: ownerType.target,
    ...(declaration.aliases.length === 0
      ? {}
      : {
          associatedAliases: Object.freeze(declaration.aliases.map((alias) => Object.freeze({
            name: alias.name,
            genericParameters: projectMojoTargetGenericParameters(alias.genericParameters, context),
            category: alias.category,
            abstract: alias.abstract,
            ...(alias.targetType === undefined
              ? {}
              : { targetType: projectMojoCompilerType(alias.targetType, context).target }),
            ...(alias.valueType === undefined
              ? {}
              : { valueType: projectMojoCompilerType(alias.valueType, context).target }),
            ...(alias.valueExpression === undefined ? {} : { valueExpression: alias.valueExpression }),
          }))),
        }),
    ...(projectedConformances.length === 0
      ? {}
      : {
          conformances: Object.freeze(projectedConformances.map(({ trait, projected }) => Object.freeze({
            trait: projected.target,
            ...(trait.condition === undefined ? {} : { condition: trait.condition }),
          }))),
        }),
  }));
  return Object.freeze({
    id: exportId,
    name: declaration.name,
    ...(sourceName === declaration.name ? {} : { exportName: sourceName }),
    kind: declaration.kind === "struct" ? "class" : "interface",
    ...(typeParameters.length === 0 ? {} : { typeParameters }),
    ...(heritage.length === 0 ? {} : { heritage: Object.freeze(heritage) }),
    members: Object.freeze(members),
    ...documentation(declaration.documentation),
  });
}

function projectStructMembers(
  declaration: MojoCompilerStruct,
  exportId: string,
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
): ProviderMemberDeclaration[] {
  const members: ProviderMemberDeclaration[] = [];
  const ownerTarget = projectMojoCompilerType({
    kind: "self",
    memberPath: Object.freeze([]),
    arguments: Object.freeze([]),
  }, context).target;
  for (const field of declaration.fields) {
    const memberId = `${exportId}::field:${field.name}`;
    const projected = projectMojoCompilerType(field.type, context);
    members.push(Object.freeze({
      id: memberId,
      name: field.name,
      kind: "field",
      type: projected.source,
      ...documentation(field.documentation),
    }));
    operations.push(Object.freeze({
      exportId,
      memberId,
      operationKind: "property",
      target: Object.freeze({ kind: "property-read", name: field.name, receiver: "ref" }),
      receiverType: ownerTarget,
      resultType: projected.target,
    }));
    operations.push(Object.freeze({
      exportId,
      memberId,
      operationKind: "property-set",
      target: Object.freeze({
        kind: "property-write",
        name: field.name,
        receiver: "mut",
        value: Object.freeze({ convention: "var", position: "positional-or-keyword" }),
      }),
      receiverType: ownerTarget,
      parameterTypes: Object.freeze([projected.target]),
      resultType: Object.freeze({ kind: "unit" }),
    }));
  }
  for (const [name, functions] of groupByName(declaration.functions)) {
    const constructor = name === "__init__";
    if (name === "__deinit__") continue;
    const memberId = `${exportId}::${constructor ? "constructor" : "method"}:${name}`;
    const signatures: ProviderSignatureDeclaration[] = [];
    for (const function_ of functions) {
      const receiver = function_.arguments.find(({ name: argumentName }) => argumentName === "self");
      if (!constructor && !function_.static && receiver === undefined) {
        throw new Error(`Mojo method '${declaration.name}.${name}' has no compiler-owned receiver convention.`);
      }
      const projected = projectFunctionSignature(function_, context, memberId);
      signatures.push(projected.signature);
      operations.push(Object.freeze({
        exportId,
        memberId,
        signatureId: projected.signature.id,
        operationKind: constructor ? "constructor" : "call",
        target: constructor || function_.static
          ? Object.freeze({
              kind: "function-call",
              modulePath: Object.freeze([context.package.packageName, ...context.modulePath]),
              ...(constructor ? {} : { ownerPath: Object.freeze([declaration.name]) }),
              name: constructor ? declaration.name : name,
              ...(function_.genericParameters.length === 0
                ? {}
          : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            })
          : Object.freeze({
              kind: "instance-call",
              name,
              receiver: receiver!.convention,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            }),
        ...(constructor || function_.static ? {} : { receiverType: ownerTarget }),
        parameterTypes: projected.parameterTargets,
        resultType: constructor ? ownerTarget : projected.resultTarget,
        ...(function_.raises ? { raises: true } : {}),
      }));
    }
    members.push(Object.freeze({
      id: memberId,
      name: constructor ? "constructor" : name,
      kind: constructor ? "constructor" : "method",
      ...(constructor ? {} : { static: functions.every(({ static: static_ }) => static_) }),
      signatures: Object.freeze(signatures),
      ...firstDocumentation(functions),
    }));
  }
  return members;
}

function projectTraitMembers(
  declaration: MojoCompilerTrait,
  exportId: string,
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
): ProviderMemberDeclaration[] {
  const ownerTarget = projectMojoCompilerType({
    kind: "self",
    memberPath: Object.freeze([]),
    arguments: Object.freeze([]),
  }, context).target;
  const members: ProviderMemberDeclaration[] = declaration.fields.map((field) => {
    const memberId = `${exportId}::field:${field.name}`;
    const projected = projectMojoCompilerType(field.type, context);
    operations.push(Object.freeze({
      exportId,
      memberId,
      operationKind: "property",
      target: Object.freeze({ kind: "property-read", name: field.name, receiver: "ref" }),
      receiverType: ownerTarget,
      resultType: projected.target,
    }));
    return Object.freeze({
      id: memberId,
      name: field.name,
      kind: "property" as const,
      type: projected.source,
      readonly: true,
      ...documentation(field.documentation),
    });
  });
  for (const [name, functions] of groupByName(declaration.functions)) {
    const memberId = `${exportId}::method:${name}`;
    const signatures: ProviderSignatureDeclaration[] = [];
    for (const function_ of functions) {
      const receiver = function_.arguments.find(({ name: argumentName }) => argumentName === "self");
      if (!function_.static && receiver === undefined) {
        throw new Error(`Mojo trait method '${declaration.name}.${name}' has no compiler-owned receiver convention.`);
      }
      const projected = projectFunctionSignature(function_, context, memberId);
      signatures.push(projected.signature);
      operations.push(Object.freeze({
        exportId,
        memberId,
        signatureId: projected.signature.id,
        operationKind: "call",
        target: function_.static
          ? Object.freeze({
              kind: "function-call",
              modulePath: Object.freeze([context.package.packageName, ...context.modulePath]),
              ownerPath: Object.freeze([declaration.name]),
              name,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            })
          : Object.freeze({
              kind: "instance-call",
              name,
              receiver: receiver!.convention,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            }),
        ...(function_.static ? {} : { receiverType: ownerTarget }),
        parameterTypes: projected.parameterTargets,
        resultType: projected.resultTarget,
        ...(function_.raises ? { raises: true } : {}),
      }));
    }
    members.push(Object.freeze({
      id: memberId,
      name,
      kind: "method",
      ...(functions.every(({ static: static_ }) => static_) ? { static: true } : {}),
      signatures: Object.freeze(signatures),
      ...firstDocumentation(functions),
    }));
  }
  return members;
}

function projectAlias(
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
      sourceGenericParameters: Object.freeze(declaration.genericParameters.map((parameter) =>
        Object.freeze({ targetName: parameter.name, targetKind: parameter.kind }))),
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

function projectFunctionSignature(
  function_: MojoCompilerFunction,
  context: MojoCompilerTypeProjectionContext,
  memberId: string | undefined,
): {
  readonly signature: ProviderSignatureDeclaration;
  readonly targetArguments: readonly MojoProviderTargetArgument[];
  readonly parameterTargets: readonly import("../../../target-model/provider/model.js").MojoTargetTypeRef[];
  readonly resultTarget: import("../../../target-model/provider/model.js").MojoTargetTypeRef;
} {
  const sourceArguments = function_.arguments.filter(({ name }) => name !== "self");
  const projectedArguments = sourceArguments.map((argument) => ({
    argument,
    type: projectMojoCompilerType(argument.type, context),
  }));
  const result = function_.result === undefined
    ? { source: Object.freeze({ kind: "void" as const }), target: Object.freeze({ kind: "unit" as const }) }
    : projectMojoCompilerType(function_.result, context);
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
      returnType: result.source,
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
    resultTarget: result.target,
  });
}

function sourceExportId(context: MojoCompilerTypeProjectionContext): string {
  return `${context.source.providerModuleId}::export:${context.source.exportName}`;
}

function groupByName<T extends { readonly name: string }>(values: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const group = result.get(value.name) ?? [];
    group.push(value);
    result.set(value.name, group);
  }
  return result;
}

function canonicalExportMappings(
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

function firstDocumentation(values: readonly { readonly documentation?: string }[]) {
  return documentation(values.find(({ documentation: value }) => value !== undefined)?.documentation);
}

function documentation(value: string | undefined): { readonly documentation?: string } {
  return value === undefined || value.length === 0 ? {} : { documentation: value };
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
