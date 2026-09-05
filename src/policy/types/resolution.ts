import {
  providerVirtualDeclarationFactKey,
} from "@tsonic/tsts";
import type { AstReader, Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "./source-profile.js";
import { mojoParameterAbi } from "../callables/parameter-abi.js";
import { argumentPassingFactKey } from "@tsonic/tsts";
import { instantiateMojoProviderType } from "./provider-instantiation.js";
import {
  authoredTupleElements,
  authoredTypeArguments,
  exactUndefinedType,
  namedType,
  providerOwnerMatches,
  resolveSourceProfileTypeArguments,
  resolveUnion,
  typeSubjects,
  uniqueProviderIdentity,
} from "./resolution-helpers.js";
import {
  mojoNativeErrorType,
  mojoSourceErrorType,
} from "../../target-model/types/error-domains.js";
import { resolveMojoRetainedType } from "./resolution-facts.js";
import { resolveMojoNonTypeGenericArguments } from "./generic-arguments.js";
import { implicitHeapLifecycle, nativeSetLifecycle } from "./lifecycle-contracts.js";
import { resolveMojoJsRegExpSourceProfileType } from "./js-regexp.js";
import { resolveMojoGenericParameterType } from "./generic-parameter-resolution.js";

export { providerOwnerMatches } from "./resolution-helpers.js";

export interface MojoTypeResolutionContext {
  readonly ast: AstReader;
  readonly navigation: import("@tsonic/target-api/source").TargetSourceProgram["navigation"];
  readonly semantics: SourceFileSemantics;
  readonly sourceFacts: import("@tsonic/tsts").ReadonlySourceFactResolver;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
}

export type MojoTypeResolution =
  | { readonly kind: "resolved"; readonly type: MojoTargetTypeRef }
  | { readonly kind: "unsupported"; readonly reason: string };

export function resolveMojoTargetType(
  selectedType: Type | undefined,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
): MojoTypeResolution {
  return resolveMojoTargetTypeWithState(selectedType, authoredTypeNode, context, new Set<Type>());
}

function resolveMojoTargetTypeWithState(
  selectedType: Type | undefined,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
  resolving: Set<Type>,
): MojoTypeResolution {
  if (selectedType === undefined) {
    return { kind: "unsupported", reason: "the TypeScript checker supplied no selected type" };
  }
  if (resolving.has(selectedType)) {
    return { kind: "unsupported", reason: "the selected TypeScript type is recursively self-referential" };
  }
  const retained = resolveMojoRetainedType(
    selectedType,
    authoredTypeNode,
    context,
    (nestedType, nestedTypeNode) => resolveMojoTargetTypeWithState(
      nestedType,
      nestedTypeNode,
      context,
      resolving,
    ),
  );
  if (retained !== undefined) return retained;
  const subjects = typeSubjects(selectedType, authoredTypeNode, context);

  const substitutionBase = context.semantics.types.substitutionBaseType(selectedType);
  if (substitutionBase !== undefined) {
    return resolveMojoTargetTypeWithState(
      substitutionBase,
      authoredTypeNode,
      context,
      resolving,
    );
  }

  resolving.add(selectedType);
  try {
    const types = context.semantics.types;
    if (types.isAny(selectedType) || types.isUnknown(selectedType)) {
      return {
        kind: "resolved",
        type: { kind: "dynamic", domain: context.jsEnabled ? "js" : "source" },
      };
    }
    if (types.isNever(selectedType)) return { kind: "resolved", type: { kind: "never" } };

    const providerIdentity = uniqueProviderIdentity(
      subjects.map((subject) => context.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey)),
    );
    if (providerIdentity.kind === "conflict") {
      return { kind: "unsupported", reason: "selected provider type identities conflict" };
    }
    if (providerIdentity.value !== undefined) {
      const candidates = context.providerSemantics.types.filter((row) =>
        providerOwnerMatches(row, providerIdentity.value!) &&
        row.exportId === providerIdentity.value!.exportId);
      if (candidates.length !== 1) {
        return {
          kind: "unsupported",
          reason: `selected provider type has ${candidates.length} Mojo carrier relations`,
        };
      }
      return instantiateMojoProviderType(
        candidates[0]!,
        selectedType,
        authoredTypeNode,
        context,
        resolving,
        (nestedType, nestedTypeNode, nestedResolving) => resolveMojoTargetTypeWithState(
          nestedType,
          nestedTypeNode,
          context,
          nestedResolving,
        ),
      );
    }

    const symbol = context.semantics.declarations.typeAliasSymbol(selectedType) ??
      context.semantics.declarations.typeSymbol(selectedType);
    const sourceProfile = context.sourceProfiles.typeIdentity(symbol, context.semantics);
    if (sourceProfile?.name === "Boolean") {
      return { kind: "resolved", type: { kind: "source-primitive", name: "bool" } };
    }
    if (sourceProfile?.name === "Number") {
      return { kind: "resolved", type: { kind: "source-primitive", name: "float64" } };
    }
    if (sourceProfile?.name === "String") {
      return { kind: "resolved", type: { kind: "native-string" } };
    }
    if (sourceProfile?.name === "Error") {
      return { kind: "resolved", type: mojoSourceErrorType() };
    }
    if (sourceProfile?.name === "Promise" || sourceProfile?.name === "PromiseLike") {
      const sourceArguments = types.effectiveTypeArguments(selectedType) ??
        types.typeArguments(selectedType);
      const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
      if (sourceArguments.length !== 1) {
        return {
          kind: "unsupported",
          reason: `selected ${sourceProfile.name} type has ${sourceArguments.length} output arguments`,
        };
      }
      const output = resolveMojoTargetTypeWithState(
        sourceArguments[0],
        authoredArguments.length === 1 ? authoredArguments[0] : undefined,
        context,
        resolving,
      );
      return output.kind === "unsupported"
        ? output
        : {
            kind: "resolved",
            type: Object.freeze({
              kind: "future",
              domain: sourceProfile.profile,
              raises: false,
              output: output.type,
            }),
          };
    }
    if (sourceProfile?.name === "Map" || sourceProfile?.name === "ReadonlyMap") {
      const arguments_ = resolveSourceProfileTypeArguments(
        selectedType,
        authoredTypeNode,
        2,
        context,
        (type, node) => resolveMojoTargetTypeWithState(type, node, context, resolving),
      );
      if (arguments_.kind === "unsupported") return arguments_;
      return context.jsEnabled
        ? {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.js.JsMap",
              ["tsonic_js"],
              "JsMap",
              arguments_.types,
              implicitHeapLifecycle,
            ),
          }
        : {
            kind: "resolved",
            type: Object.freeze({
              kind: "dictionary",
              key: arguments_.types[0]!,
              value: arguments_.types[1]!,
            }),
          };
    }
    if (sourceProfile?.name === "Set" || sourceProfile?.name === "ReadonlySet") {
      const arguments_ = resolveSourceProfileTypeArguments(
        selectedType,
        authoredTypeNode,
        1,
        context,
        (type, node) => resolveMojoTargetTypeWithState(type, node, context, resolving),
      );
      if (arguments_.kind === "unsupported") return arguments_;
      return context.jsEnabled
        ? {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.js.JsSet",
              ["tsonic_js"],
              "JsSet",
              arguments_.types,
              implicitHeapLifecycle,
            ),
          }
        : {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.native.Set",
              ["std", "collections"],
              "Set",
              arguments_.types,
              nativeSetLifecycle,
            ),
          };
    }
    if (sourceProfile?.name === "IterableIterator") {
      const arguments_ = resolveSourceProfileTypeArguments(
        selectedType,
        authoredTypeNode,
        3,
        context,
        (type, node) => resolveMojoTargetTypeWithState(type, node, context, resolving),
      );
      if (arguments_.kind === "unsupported") return arguments_;
      return context.jsEnabled
        ? {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.js.JsArray",
              ["tsonic_js"],
              "JsArray",
              [arguments_.types[0]!],
              implicitHeapLifecycle,
            ),
          }
        : { kind: "resolved", type: { kind: "list", element: arguments_.types[0]! } };
    }
    if (sourceProfile?.name === "Symbol") {
      return context.jsEnabled
        ? { kind: "resolved", type: { kind: "symbol" } }
        : { kind: "unsupported", reason: "TypeScript symbol values require the explicit JavaScript surface" };
    }
    if (sourceProfile?.name === "Date") {
      return sourceProfile.profile === "js"
        ? {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.js.JsDate",
              ["tsonic_js"],
              "JsDate",
              [],
              implicitHeapLifecycle,
            ),
          }
        : {
            kind: "unsupported",
            reason: "Date values require the explicit JavaScript source profile",
          };
    }
    if (sourceProfile !== undefined) {
      if (sourceProfile.profile !== "js" && sourceProfile.name.startsWith("RegExp")) {
        return {
          kind: "unsupported",
          reason: "RegExp values require the explicit JavaScript source profile",
        };
      }
      const sourceArguments = types.effectiveTypeArguments(selectedType) ??
        types.typeArguments(selectedType);
      const targetArguments: MojoTargetTypeRef[] = [];
      for (const sourceArgument of sourceArguments) {
        const argument = resolveMojoTargetTypeWithState(
          sourceArgument,
          undefined,
          context,
          resolving,
        );
        if (argument.kind === "unsupported") return argument;
        targetArguments.push(argument.type);
      }
      const regexp = resolveMojoJsRegExpSourceProfileType(
        sourceProfile.name,
        targetArguments,
      );
      if (regexp !== undefined) return regexp;
    }
    const genericParameter = resolveMojoGenericParameterType(
      selectedType,
      symbol,
      context,
      resolving,
      (nestedType, nestedTypeNode, nestedResolving) => resolveMojoTargetTypeWithState(
        nestedType,
        nestedTypeNode,
        context,
        nestedResolving,
      ),
    );
    if (genericParameter !== undefined) return genericParameter;

    const sourceArguments = types.effectiveTypeArguments(selectedType) ?? types.typeArguments(selectedType);
    const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
    const projectDefinition = context.projectTypes.definitionForSymbol(
      symbol,
      context.semantics.declarations.symbolDeclarations,
    );
    if (projectDefinition !== undefined) {
      if (sourceArguments.length !== projectDefinition.typeParameters.length) {
        return {
          kind: "unsupported",
          reason: `project type '${projectDefinition.sourceName}' has ${sourceArguments.length} source arguments for ${projectDefinition.typeParameters.length} parameters`,
        };
      }
      const targetArguments: MojoTargetGenericArgument[] = [];
      for (const [index, parameter] of projectDefinition.typeParameters.entries()) {
        const sourceArgument = sourceArguments[index]!;
        const authoredArgument = authoredArguments.length === sourceArguments.length
          ? authoredArguments[index]
          : undefined;
        if (parameter.kind === "type") {
          const argument = resolveMojoTargetTypeWithState(
            sourceArgument,
            authoredArgument,
            context,
            resolving,
          );
          if (argument.kind === "unsupported") return argument;
          targetArguments.push(Object.freeze({ kind: "type", type: argument.type }));
          continue;
        }
        if (authoredArgument === undefined) {
          return {
            kind: "unsupported",
            reason: `project ${parameter.kind} parameter '${parameter.name}' has no exact authored argument`,
          };
        }
        const argument = resolveMojoNonTypeGenericArguments({
          kind: parameter.kind,
          name: parameter.name,
          position: "positional-or-keyword",
          variadic: false,
          constraints: Object.freeze([]),
        }, authoredArgument, context);
        const targetArgument = argument?.length === 1 ? argument[0] : undefined;
        if (targetArgument === undefined ||
          !genericArgumentMatchesKind(targetArgument, parameter.kind)) {
          return {
            kind: "unsupported",
            reason: `project ${parameter.kind} parameter '${parameter.name}' has no exact closed target argument`,
          };
        }
        targetArguments.push(targetArgument);
      }
      const projectType = context.projectTypes.targetTypeForDefinition(projectDefinition, targetArguments);
      return projectType === undefined
        ? {
            kind: "unsupported",
            reason: `project type '${projectDefinition.sourceName}' has incompatible target generic arguments`,
          }
        : { kind: "resolved", type: projectType };
    }

    const targetArguments: MojoTargetTypeRef[] = [];
    for (const [index, sourceArgument] of sourceArguments.entries()) {
      const argument = resolveMojoTargetTypeWithState(
        sourceArgument,
        authoredArguments.length === sourceArguments.length ? authoredArguments[index] : undefined,
        context,
        resolving,
      );
      if (argument.kind === "unsupported") return argument;
      targetArguments.push(argument.type);
    }

    const callable = types.callable(selectedType);
    if (callable !== undefined) {
      const parameters: Extract<MojoTargetTypeRef, { kind: "callable" }>["parameters"][number][] = [];
      for (const parameter of callable.parameters) {
        const resolved = resolveMojoTargetTypeWithState(
          parameter.type,
          parameter.declaration === undefined ? undefined : context.ast.typeNode(parameter.declaration),
          context,
          resolving,
        );
        if (resolved.kind === "unsupported") return resolved;
        const abi = mojoParameterAbi(
          parameter.declaration === undefined
            ? undefined
            : context.sourceFacts.getFact(parameter.declaration, argumentPassingFactKey)?.mode,
        );
        const omissionKind = parameter.omissionKind;
        const parameterType = omissionKind !== "required" && omissionKind !== "rest" &&
            resolved.type.kind !== "optional"
          ? Object.freeze({ kind: "optional" as const, value: resolved.type })
          : resolved.type;
        parameters.push(Object.freeze({
          name: context.semantics.declarations.symbolName(parameter.sourceSymbol),
          convention: abi.convention,
          passing: abi.passing,
          type: parameterType,
          omissionKind,
        }));
      }
      const result = resolveMojoTargetTypeWithState(
        callable.result.selectedType,
        callable.result.authoredTypeNode,
        context,
        resolving,
      );
      if (result.kind === "unsupported") return result;
      return {
        kind: "resolved",
        type: Object.freeze({
          kind: "callable",
          parameters: Object.freeze(parameters),
          result: result.type,
          raises: true,
          errorType: context.sourceCallableErrorType ?? mojoNativeErrorType(),
        }),
      };
    }

    if (types.isUnion(selectedType)) {
      return resolveUnion(
        selectedType,
        authoredTypeNode,
        context,
        (member, authoredMember) => resolveMojoTargetTypeWithState(
          member,
          authoredMember,
          context,
          resolving,
        ),
      );
    }
    if (types.isTuple(selectedType)) {
      const infos = types.tupleElementInfos(selectedType);
      if (infos.some((info) => info.elementKind !== "required")) {
        return {
          kind: "unsupported",
          reason: "optional, rest, and variadic tuple elements require a closed Mojo tuple ABI",
        };
      }
      const authoredElements = authoredTupleElements(authoredTypeNode, context.ast);
      const elements: MojoTargetTypeRef[] = [];
      for (const [index, info] of infos.entries()) {
        const element = resolveMojoTargetTypeWithState(
          info.type,
          authoredElements.length === infos.length
            ? authoredElements[index]
            : info.declaration === undefined
              ? undefined
              : context.ast.typeNode(info.declaration),
          context,
          resolving,
        );
        if (element.kind === "unsupported") return element;
        elements.push(element.type);
      }
      return { kind: "resolved", type: { kind: "tuple", elements: Object.freeze(elements) } };
    }
    if (types.isNullish(selectedType)) {
      return {
        kind: "resolved",
        type: exactUndefinedType(selectedType, context)
          ? { kind: "undefined" }
          : { kind: "null" },
      };
    }
    if (types.isVoidLike(selectedType)) return { kind: "resolved", type: { kind: "unit" } };
    if (types.isBooleanLike(selectedType)) {
      return { kind: "resolved", type: { kind: "source-primitive", name: "bool" } };
    }
    if (types.isStringLike(selectedType)) {
      return { kind: "resolved", type: { kind: "native-string" } };
    }
    if (types.isNumberLike(selectedType)) {
      return { kind: "resolved", type: { kind: "source-primitive", name: "float64" } };
    }
    if (types.isBigIntLike(selectedType)) return { kind: "resolved", type: { kind: "bigint" } };
    if (types.isArrayLike(selectedType)) {
      if (targetArguments.length !== 1) {
        return {
          kind: "unsupported",
          reason: `selected array type has ${targetArguments.length} target element arguments`,
        };
      }
      return context.jsEnabled
        ? {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.js.JsArray",
              ["tsonic_js"],
              "JsArray",
              [targetArguments[0]!],
              implicitHeapLifecycle,
            ),
          }
        : { kind: "resolved", type: { kind: "list", element: targetArguments[0]! } };
    }

    const indexInfos = types.indexInfos(selectedType);
    const properties = types.propertyInfos(selectedType);
    if (indexInfos.length === 1 && properties.length === 0 &&
      types.callSignatures(selectedType).length === 0 &&
      types.constructSignatures(selectedType).length === 0) {
      const key = resolveMojoTargetTypeWithState(indexInfos[0]!.keyType, undefined, context, resolving);
      const value = resolveMojoTargetTypeWithState(indexInfos[0]!.valueType, undefined, context, resolving);
      return key.kind === "unsupported"
        ? key
        : value.kind === "unsupported"
          ? value
          : { kind: "resolved", type: { kind: "dictionary", key: key.type, value: value.type } };
    }
    return {
      kind: "unsupported",
      reason: "the selected TypeScript type has no exact Mojo carrier relation",
    };
  } finally {
    resolving.delete(selectedType);
  }
}

function genericArgumentMatchesKind(
  argument: MojoTargetGenericArgument,
  kind: "type" | "value" | "origin",
): boolean {
  if (kind === "type") return argument.kind === "type";
  if (kind === "origin") return argument.kind === "origin";
  return argument.kind !== "type" && argument.kind !== "origin" && argument.kind !== "unbound";
}
