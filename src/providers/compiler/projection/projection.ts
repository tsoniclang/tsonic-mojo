import type {
  ArgumentPassingMode,
  ProviderExportDeclaration,
  ProviderImportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";
import type {
  MojoCompilerAlias,
  MojoCompilerFunction,
  MojoCompilerGenericParameter,
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
import { mojoCompilerModuleSpecifier } from "./module-specifier.js";
import type { MojoCompilerProviderProjection } from "./model.js";
import {
  projectMojoCompilerType,
  projectMojoGenericParameters,
} from "./types.js";
import type { MojoCompilerTypeProjectionContext } from "./types.js";

export function projectMojoCompilerModule(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleModel,
  options: {
    readonly providerModuleId: string;
    readonly moduleSpecifier: string;
    readonly requestedExports?: readonly string[];
  },
): MojoCompilerProviderProjection {
  if (module.packageId !== package_.id || module.packageVersion !== package_.version ||
    !samePath(module.modulePath, findModulePath(package_, options.moduleSpecifier))) {
    throw new Error(`Mojo compiler module '${module.moduleIdentity}' does not match its requested package/module identity.`);
  }
  const imports = new Map<string, Set<string>>();
  const operations: MojoProviderOperationDefinition[] = [];
  const types: MojoProviderTypeDefinition[] = [];
  const baseContext: MojoCompilerTypeProjectionContext = {
    snapshot,
    package: package_,
    modulePath: module.modulePath,
    localDeclarations: new Set(module.declarations.map(({ name }) => name)),
    imports,
  };
  const requested = options.requestedExports === undefined
    ? undefined
    : new Set(options.requestedExports);
  const available = new Set([
    ...module.functions.map(({ name }) => name),
    ...module.declarations.map(({ name }) => name),
  ]);
  if (requested !== undefined) {
    for (const name of requested) {
      if (!available.has(name)) throw new Error(`Mojo module has no exported declaration '${name}'.`);
    }
  }
  const exports: ProviderExportDeclaration[] = [];
  for (const [name, functions] of groupByName(module.functions)) {
    if (requested !== undefined && !requested.has(name)) continue;
    exports.push(projectFunctionExport(name, functions, baseContext, operations));
  }
  for (const declaration of module.declarations) {
    if (requested !== undefined && !requested.has(declaration.name)) continue;
    exports.push(projectTypeDeclaration(declaration, baseContext, operations, types));
  }
  const ownSpecifier = mojoCompilerModuleSpecifier(package_, module.modulePath);
  imports.delete(ownSpecifier);
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
  functions: readonly MojoCompilerFunction[],
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
): ProviderExportDeclaration {
  const exportId = `${moduleIdentity(context)}::export:function:${name}`;
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
          : { genericParameters: targetGenericParameters(function_.genericParameters, context) }),
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
    kind: "function",
    signatures: Object.freeze(signatures),
    ...firstDocumentation(functions),
  });
}

function projectTypeDeclaration(
  declaration: MojoCompilerTypeDeclaration,
  parentContext: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
  types: MojoProviderTypeDefinition[],
): ProviderExportDeclaration {
  if (declaration.kind === "alias") {
    return projectAlias(declaration, parentContext, operations, types);
  }
  const exportId = `${moduleIdentity(parentContext)}::export:${declaration.kind}:${declaration.name}`;
  const context: MojoCompilerTypeProjectionContext = {
    ...parentContext,
    owner: {
      name: declaration.name,
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
    targetType: ownerType.target,
    ...(declaration.aliases.length === 0
      ? {}
      : {
          associatedAliases: Object.freeze(declaration.aliases.map((alias) => Object.freeze({
            name: alias.name,
            genericParameters: targetGenericParameters(alias.genericParameters, context),
            category: alias.category,
            ...(alias.targetType === undefined
              ? {}
              : { targetType: projectMojoCompilerType(alias.targetType, context).target }),
            ...(alias.valueType === undefined
              ? {}
              : { valueType: projectMojoCompilerType(alias.valueType, context).target }),
            valueExpression: alias.valueExpression,
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
                : { genericParameters: targetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            })
          : Object.freeze({
              kind: "instance-call",
              name,
              receiver: receiver!.convention,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: targetGenericParameters(function_.genericParameters, context) }),
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
                : { genericParameters: targetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            })
          : Object.freeze({
              kind: "instance-call",
              name,
              receiver: receiver!.convention,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: targetGenericParameters(function_.genericParameters, context) }),
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
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
  types: MojoProviderTypeDefinition[],
): ProviderExportDeclaration {
  const exportId = `${moduleIdentity(context)}::export:alias:${declaration.name}`;
  if (declaration.category === "type") {
    if (declaration.targetType === undefined) {
      throw new Error(`Mojo type alias '${declaration.name}' has no exact target type.`);
    }
    const projected = projectMojoCompilerType(declaration.targetType, context);
    types.push(Object.freeze({ exportId, targetType: projected.target }));
    return Object.freeze({
      id: exportId,
      name: declaration.name,
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
      passingMode: passingMode(argument.convention),
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

function targetGenericParameters(
  parameters: readonly MojoCompilerGenericParameter[],
  context: MojoCompilerTypeProjectionContext,
) {
  return Object.freeze(parameters.map((parameter) => Object.freeze({
    kind: parameter.kind,
    name: parameter.name,
    position: parameter.passingKind,
    variadic: parameter.variadic,
    constraints: Object.freeze(parameter.constraints.map((constraint) =>
      projectMojoCompilerType(constraint, context).target)),
    ...(parameter.defaultArgument === undefined
      ? {}
      : { defaultArgument: projectTargetGenericArgument(parameter.defaultArgument, context) }),
  })));
}

function projectTargetGenericArgument(
  argument: import("../model/model.js").MojoCompilerTypeArgument,
  context: MojoCompilerTypeProjectionContext,
): import("../../../target-model/provider/model.js").MojoTargetGenericArgument {
  if (argument.kind === "type") {
    return Object.freeze({ kind: "type", type: projectMojoCompilerType(argument.type, context).target });
  }
  if (argument.kind === "value") {
    return Object.freeze({ kind: "value", expression: argument.expression });
  }
  if (argument.kind === "type-expression") {
    return Object.freeze({ kind: "type-expression", expression: argument.expression });
  }
  return Object.freeze({ kind: "unbound" });
}

function passingMode(convention: MojoCompilerFunction["arguments"][number]["convention"]): ArgumentPassingMode {
  switch (convention) {
    case "imm": return "byref-readonly";
    case "mut": return "byref-readwrite";
    case "var": return "move";
    case "ref": return "borrow-shared";
    case "out": return "byref-writeonly-must-init";
    case "deinit": return "move";
  }
}

function moduleIdentity(context: MojoCompilerTypeProjectionContext): string {
  return `${context.package.id}@${context.package.version}:${context.package.sourceDigest}:${context.modulePath.join(".")}`;
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

function findModulePath(
  package_: MojoCompilerPackageSnapshot,
  moduleSpecifier: string,
): readonly string[] {
  const match = package_.modules.find((module) =>
    mojoCompilerModuleSpecifier(package_, module.modulePath) === moduleSpecifier);
  if (match === undefined) throw new Error(`Mojo module specifier '${moduleSpecifier}' has no package module.`);
  return match.modulePath;
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
