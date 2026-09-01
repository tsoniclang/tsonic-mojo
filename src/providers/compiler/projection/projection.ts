import type {
  ProviderExportDeclaration,
  ProviderImportDeclaration,
  ProviderMemberDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";
import type {
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
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoCompilerProviderProjection } from "./model.js";
import {
  projectMojoCompilerType,
  projectMojoGenericParameters,
  projectMojoTargetGenericParameters,
  sourceVisibleMojoGenericParameters,
} from "./types.js";
import type { MojoCompilerTypeProjectionContext } from "./types.js";
import {
  canonicalExportMappings,
  compareText,
  documentation,
  firstDocumentation,
  groupByName,
  projectAlias,
  projectFunctionSignature,
  samePath,
  sourceExportId,
} from "./declaration-support.js";

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
      ? declaration.genericParameters.map((parameter) => parameter.passingKind === "inferred"
          ? Object.freeze({ kind: "unbound" as const })
          : parameter.kind === "type"
            ? Object.freeze({ kind: "type" as const, type: Object.freeze({ kind: "type-parameter" as const, name: parameter.name }) })
            : Object.freeze({ kind: "value" as const, expression: parameter.name }))
      : Object.freeze([]),
  }, context);
  types.push(Object.freeze({
    exportId,
    sourceGenericParameters: Object.freeze((declaration.kind === "struct"
      ? sourceVisibleMojoGenericParameters(declaration.genericParameters)
      : []).map((parameter) => Object.freeze({
        targetName: parameter.name,
        targetKind: parameter.kind,
        variadic: parameter.variadic,
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
      target: Object.freeze({
        kind: "property-read",
        access: Object.freeze({ kind: "member", name: field.name }),
        receiver: "ref",
      }),
      receiverType: ownerTarget,
      resultType: projected.target,
    }));
    operations.push(Object.freeze({
      exportId,
      memberId,
      operationKind: "property-set",
      target: Object.freeze({
        kind: "property-write",
        access: Object.freeze({ kind: "member", name: field.name }),
        receiver: "mut",
        value: Object.freeze({ convention: "var", position: "positional-or-keyword" }),
      }),
      receiverType: ownerTarget,
      parameterTypes: Object.freeze([projected.target]),
      resultType: Object.freeze({ kind: "unit" }),
    }));
  }
  const functionsByName = groupByName(declaration.functions);
  const projectedIndex = projectStructIndexers(
    declaration,
    exportId,
    ownerTarget,
    context,
    operations,
    functionsByName.get("__getitem__") ?? [],
    functionsByName.get("__setitem__") ?? [],
  );
  if (projectedIndex.member !== undefined) members.push(projectedIndex.member);
  for (const [name, functions] of functionsByName) {
    const retainedFunctions = name === "__getitem__"
      ? []
      : name === "__setitem__"
        ? functions.filter((function_) => !projectedIndex.consumedSetters.has(function_))
        : functions;
    if (retainedFunctions.length === 0) continue;
    const constructor = name === "__init__";
    if (name === "__deinit__") continue;
    const memberId = `${exportId}::${constructor ? "constructor" : "method"}:${name}`;
    const signatures: ProviderSignatureDeclaration[] = [];
    for (const function_ of retainedFunctions) {
      if (constructor && function_.asynchronous) {
        throw new Error(
          `Mojo initializer '${declaration.name}.__init__' is asynchronous and cannot be projected as a TypeScript constructor.`,
        );
      }
      const receiver = function_.arguments.find(({ name: argumentName }) => argumentName === "self");
      if (!constructor && !function_.static && receiver === undefined) {
        throw new Error(`Mojo method '${declaration.name}.${name}' has no compiler-owned receiver convention.`);
      }
      if (!function_.static && receiver !== undefined && !isDirectSelfReceiver(receiver.type)) {
        throw new Error(
          `Mojo method '${declaration.name}.${name}' has a custom receiver that one TypeScript instance value cannot represent exactly.`,
        );
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
      ...(constructor ? {} : { static: retainedFunctions.every(({ static: static_ }) => static_) }),
      signatures: Object.freeze(signatures),
      ...firstDocumentation(retainedFunctions),
    }));
  }
  return members;
}

function projectStructIndexers(
  declaration: MojoCompilerStruct,
  exportId: string,
  ownerTarget: import("../../../target-model/types/model.js").MojoTargetTypeRef,
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
  getters: readonly MojoCompilerFunction[],
  setters: readonly MojoCompilerFunction[],
): {
  readonly member?: ProviderMemberDeclaration;
  readonly consumedSetters: ReadonlySet<MojoCompilerFunction>;
} {
  if (getters.length === 0) return { consumedSetters: new Set() };
  const memberId = `${exportId}::indexer`;
  const getterRows = getters.map((function_) => {
    const receiver = function_.arguments.find(({ name }) => name === "self");
    if (function_.static || receiver === undefined) {
      throw new Error(`Mojo index getter '${declaration.name}.__getitem__' has no compiler-owned instance receiver.`);
    }
    if (!isDirectSelfReceiver(receiver.type)) {
      throw new Error(`Mojo index getter '${declaration.name}.__getitem__' has an unrepresentable custom receiver.`);
    }
    const projected = projectFunctionSignature(function_, context, memberId);
    if (projected.parameterTargets.length !== 1 || projected.resultTarget.kind === "unit") {
      throw new Error(`Mojo index getter '${declaration.name}.__getitem__' must have one index and one value result.`);
    }
    return Object.freeze({ function_, receiver, projected });
  });
  const setterRows = setters.map((function_) => {
    const receiver = function_.arguments.find(({ name }) => name === "self");
    if (function_.static || receiver === undefined) {
      throw new Error(`Mojo index setter '${declaration.name}.__setitem__' has no compiler-owned instance receiver.`);
    }
    if (!isDirectSelfReceiver(receiver.type)) {
      throw new Error(`Mojo index setter '${declaration.name}.__setitem__' has an unrepresentable custom receiver.`);
    }
    const projected = projectFunctionSignature(function_, context, memberId);
    if (projected.parameterTargets.length !== 2 || projected.resultTarget.kind !== "unit") {
      throw new Error(`Mojo index setter '${declaration.name}.__setitem__' must have one index, one value, and no result.`);
    }
    return Object.freeze({ function_, receiver, projected });
  });
  const consumedSetters = new Set<MojoCompilerFunction>();
  const signatures: ProviderSignatureDeclaration[] = [];
  let writableSignatureCount = 0;
  for (const getter of getterRows) {
    signatures.push(getter.projected.signature);
    operations.push(Object.freeze({
      exportId,
      memberId,
      signatureId: getter.projected.signature.id,
      operationKind: "indexer",
      target: Object.freeze({
        kind: "index-read",
        access: Object.freeze({ kind: "element" }),
        receiver: getter.receiver.convention,
        index: getter.projected.targetArguments[0]!,
      }),
      receiverType: ownerTarget,
      parameterTypes: getter.projected.parameterTargets,
      resultType: getter.projected.resultTarget,
      ...(getter.function_.raises ? { raises: true } : {}),
    }));
    const matchingSetters = setterRows.filter(({ projected }) =>
      mojoTargetTypeEquals(projected.parameterTargets[0]!, getter.projected.parameterTargets[0]!) &&
      mojoTargetTypeEquals(projected.parameterTargets[1]!, getter.projected.resultTarget));
    if (matchingSetters.length > 1) {
      throw new Error(`Mojo index getter '${declaration.name}.__getitem__' has ${matchingSetters.length} exact setter ABIs.`);
    }
    const setter = matchingSetters[0];
    if (setter === undefined) continue;
    writableSignatureCount += 1;
    consumedSetters.add(setter.function_);
    operations.push(Object.freeze({
      exportId,
      memberId,
      signatureId: getter.projected.signature.id,
      operationKind: "index-set",
      target: Object.freeze({
        kind: "index-write",
        access: Object.freeze({ kind: "element" }),
        receiver: setter.receiver.convention,
        index: setter.projected.targetArguments[0]!,
        value: setter.projected.targetArguments[1]!,
      }),
      receiverType: ownerTarget,
      parameterTypes: setter.projected.parameterTargets,
      resultType: Object.freeze({ kind: "unit" }),
      ...(setter.function_.raises ? { raises: true } : {}),
    }));
  }
  if (writableSignatureCount !== 0 && writableSignatureCount !== getterRows.length) {
    throw new Error(
      `Mojo indexer '${declaration.name}' mixes writable and read-only overloads that one TypeScript index contract cannot represent exactly.`,
    );
  }
  return {
    member: Object.freeze({
      id: memberId,
      name: "index",
      kind: "indexer",
      ...(writableSignatureCount === 0 ? { readonly: true } : {}),
      signatures: Object.freeze(signatures),
      ...firstDocumentation(getters),
    }),
    consumedSetters,
  };
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
      target: Object.freeze({
        kind: "property-read",
        access: Object.freeze({ kind: "member", name: field.name }),
        receiver: "ref",
      }),
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
      if (!function_.static && receiver !== undefined && !isDirectSelfReceiver(receiver.type)) {
        throw new Error(
          `Mojo trait method '${declaration.name}.${name}' has a custom receiver that one TypeScript instance value cannot represent exactly.`,
        );
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

function isDirectSelfReceiver(type: import("../model/model.js").MojoCompilerType): boolean {
  return type.kind === "self" && type.memberPath.length === 0 && type.arguments.length === 0;
}
