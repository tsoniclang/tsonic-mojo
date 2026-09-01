import {
  pointerFactKey,
  providerVirtualDeclarationFactKey,
  rawPointerFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type { AstReader, Node, Type } from "@tsonic/tsts";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { MojoProviderSemantics, MojoProviderTypeRow } from "../../providers/packages/model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "./source-profile.js";
import { mojoParameterAbi } from "../callables/parameter-abi.js";
import { argumentPassingFactKey } from "@tsonic/tsts";
import { resolveMojoSourcePrimitive } from "./source-primitives.js";
import { resolveMojoNonTypeGenericArguments } from "./generic-arguments.js";
import {
  authoredTupleElements,
  authoredTypeArguments,
  exactUndefinedType,
  namedType,
  providerOwnerMatches,
  resolveSourceProfileTypeArguments,
  resolveTypeParameter,
  resolveUnion,
  typeSubjects,
  uniqueFact,
  uniqueFixedArrayFact,
  uniqueProviderIdentity,
} from "./resolution-helpers.js";

export { providerOwnerMatches } from "./resolution-helpers.js";

export interface MojoTypeResolutionContext {
  readonly ast: AstReader;
  readonly semantics: SourceFileSemantics;
  readonly sourceFacts: import("@tsonic/tsts").ReadonlySourceFactResolver;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
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
  const subjects = typeSubjects(selectedType, authoredTypeNode, context);
  const rawPointer = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, rawPointerFactKey)),
  );
  if (rawPointer.kind === "conflict") {
    return { kind: "unsupported", reason: "selected raw-pointer facts conflict" };
  }
  if (rawPointer.value !== undefined) {
    return rawPointer.value.representation === "opaque-identity"
      ? {
          kind: "resolved",
          type: Object.freeze({
            kind: "target-named",
            id: "tsonic.mojo.runtime.RawPointer",
            modulePath: Object.freeze(["tsonic_runtime"]),
            name: "RawPointer",
          }),
        }
      : { kind: "unsupported", reason: "selected raw-pointer representation is not opaque identity" };
  }
  const pointer = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, pointerFactKey)),
  );
  if (pointer.kind === "conflict") {
    return { kind: "unsupported", reason: "selected typed-location facts conflict" };
  }
  if (pointer.value !== undefined) {
    const selectedPointee = context.semantics.types.authoredType(pointer.value.pointee);
    const pointee = resolveMojoTargetTypeWithState(
      selectedPointee,
      pointer.value.pointee,
      context,
      resolving,
    );
    return pointee.kind === "unsupported"
      ? pointee
      : {
          kind: "resolved",
          type: Object.freeze({
            kind: "target-named",
            id: "tsonic.mojo.runtime.Location",
            modulePath: Object.freeze(["tsonic_runtime"]),
            name: "Location",
            genericArguments: Object.freeze([Object.freeze({ kind: "type", type: pointee.type })]),
          }),
        };
  }
  const primitive = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, sourcePrimitiveFactKey)),
  );
  if (primitive.kind === "conflict") {
    return { kind: "unsupported", reason: "selected source primitive facts conflict" };
  }
  if (primitive.value !== undefined) return resolveMojoSourcePrimitive(primitive.value);

  const fixedArray = uniqueFixedArrayFact(subjects.map((subject) =>
    context.sourceFacts.getFact(subject, tsonicFixedArrayFactKey)));
  if (fixedArray.kind === "conflict") {
    return { kind: "unsupported", reason: "selected fixed-array facts conflict" };
  }
  if (fixedArray.value !== undefined) {
    const elementType = context.semantics.types.authoredType(fixedArray.value.elementType);
    const element = resolveMojoTargetTypeWithState(
      elementType,
      fixedArray.value.elementType,
      context,
      resolving,
    );
    return element.kind === "unsupported"
      ? element
      : {
          kind: "resolved",
          type: Object.freeze({
            kind: "fixed-array",
            element: element.type,
            length: Object.freeze({
              kind: "integer",
              value: String(fixedArray.value.length),
            }),
          }),
        };
  }

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
      return instantiateProviderType(
        candidates[0]!,
        selectedType,
        authoredTypeNode,
        context,
        resolving,
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
      return context.jsEnabled
        ? {
            kind: "resolved",
            type: namedType("tsonic.mojo.js.JsString", ["tsonic_js"], "JsString"),
          }
        : { kind: "resolved", type: { kind: "native-string" } };
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
            ),
          }
        : {
            kind: "resolved",
            type: namedType(
              "tsonic.mojo.native.Set",
              ["std", "collections"],
              "Set",
              arguments_.types,
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
            type: namedType("tsonic.mojo.js.JsDate", ["tsonic_js"], "JsDate"),
          }
        : {
            kind: "unsupported",
            reason: "Date values require the explicit JavaScript source profile",
          };
    }
    if (sourceProfile?.name === "RegExp") {
      return {
        kind: "unsupported",
        reason: sourceProfile.profile === "js"
          ? "the pinned Mojo runtime has no exact ECMAScript RegExp engine"
          : "RegExp values require the explicit JavaScript source profile",
      };
    }
    const typeParameter = resolveTypeParameter(symbol, context);
    if (typeParameter !== undefined) return { kind: "resolved", type: typeParameter };

    const sourceArguments = types.effectiveTypeArguments(selectedType) ?? types.typeArguments(selectedType);
    const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
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
    const projectDefinition = context.projectTypes.definitionForSymbol(
      symbol,
      context.semantics.declarations.symbolDeclarations,
    );
    if (projectDefinition !== undefined) {
      const projectType = context.projectTypes.targetTypeForDefinition(projectDefinition, targetArguments);
      return projectType === undefined
        ? {
            kind: "unsupported",
            reason: `project type '${projectDefinition.sourceName}' has ${targetArguments.length} target arguments for ${projectDefinition.typeParameterNames.length} parameters`,
          }
        : { kind: "resolved", type: projectType };
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
        parameters.push(Object.freeze({
          name: context.semantics.declarations.symbolName(parameter.sourceSymbol),
          convention: abi.convention,
          passing: abi.passing,
          type: resolved.type,
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
          raises: false,
        }),
      };
    }

    if (types.isUnion(selectedType)) {
      return resolveUnion(
        selectedType,
        context,
        (member) => resolveMojoTargetTypeWithState(member, undefined, context, resolving),
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
      return context.jsEnabled
        ? {
            kind: "resolved",
            type: namedType("tsonic.mojo.js.JsString", ["tsonic_js"], "JsString"),
          }
        : { kind: "resolved", type: { kind: "native-string" } };
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

function instantiateProviderType(
  row: MojoProviderTypeRow,
  selectedType: Type,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
  resolving: Set<Type>,
): MojoTypeResolution {
  const sourceArguments = context.semantics.types.effectiveTypeArguments(selectedType) ??
    context.semantics.types.typeArguments(selectedType);
  if (sourceArguments.length !== row.sourceGenericParameters.length) {
    return {
      kind: "unsupported",
      reason: `selected provider type supplies ${sourceArguments.length} generic arguments for ${row.sourceGenericParameters.length} exact Mojo parameters`,
    };
  }
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const valueSubstitutions = new Map<string, MojoTargetGenericArgument>();
  const packSubstitutions = new Map<string, readonly MojoTargetGenericArgument[]>();
  const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
  for (const [index, parameter] of row.sourceGenericParameters.entries()) {
    const sourceArgument = sourceArguments[index]!;
    const authoredArgument = authoredArguments.length === sourceArguments.length
      ? authoredArguments[index]
      : undefined;
    if (parameter.targetKind !== "type") {
      if (authoredArgument === undefined) {
        return {
          kind: "unsupported",
          reason: `Mojo ${parameter.targetKind} parameter '${parameter.targetName}' has no exact authored source argument`,
        };
      }
      const arguments_ = resolveMojoNonTypeGenericArguments({
        kind: parameter.targetKind,
        name: parameter.targetName,
        position: "positional",
        variadic: parameter.variadic,
        constraints: Object.freeze([]),
      }, authoredArgument, context.ast);
      if (arguments_ === undefined || arguments_.length === 0 ||
        (!parameter.variadic && arguments_.length !== 1)) {
        return {
          kind: "unsupported",
          reason: `Mojo ${parameter.targetKind} parameter '${parameter.targetName}' has no closed source generic-value evidence`,
        };
      }
      if (parameter.variadic) packSubstitutions.set(parameter.targetName, arguments_);
      else valueSubstitutions.set(parameter.targetName, arguments_[0]!);
      continue;
    }
    const resolved = resolveMojoTargetTypeWithState(
      sourceArgument,
      authoredArgument,
      context,
      resolving,
    );
    if (resolved.kind === "unsupported") return resolved;
    if (parameter.variadic) {
      if (resolved.type.kind !== "tuple") {
        return {
          kind: "unsupported",
          reason: `Mojo variadic type parameter '${parameter.targetName}' requires one exact tuple pack`,
        };
      }
      packSubstitutions.set(parameter.targetName, Object.freeze(resolved.type.elements.map((type) =>
        Object.freeze({ kind: "type" as const, type }))));
    } else {
      typeSubstitutions.set(parameter.targetName, resolved.type);
    }
  }
  return {
    kind: "resolved",
    type: substituteMojoTargetType(row.targetType, {
      types: typeSubstitutions,
      values: valueSubstitutions,
      packs: packSubstitutions,
    }),
  };
}
