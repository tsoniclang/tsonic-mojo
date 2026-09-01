import {
  providerVirtualDeclarationFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type {
  AstReader,
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  Type,
} from "@tsonic/tsts";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import { ArrayTypeNode_ElementType } from "@tsonic/target-api/source";
import type { MojoProviderSemantics, MojoProviderTypeRow } from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type {
  MojoTargetConstArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "./source-profile.js";
import { mojoParameterAbi } from "../callables/parameter-abi.js";
import { argumentPassingFactKey } from "@tsonic/tsts";
import { resolveMojoSourcePrimitive } from "./source-primitives.js";

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
              output: output.type,
            }),
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
      const parameters: Extract<MojoTargetTypeRef, { kind: "function" }>["parameters"][number][] = [];
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
          kind: "function",
          genericParameters: Object.freeze([]),
          parameters: Object.freeze(parameters),
          result: result.type,
          asynchronous: false,
          thin: false,
          raises: false,
          capture: "*",
        }),
      };
    }

    if (types.isUnion(selectedType)) return resolveUnion(selectedType, context, resolving);
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
    if (types.isSymbolLike(selectedType)) {
      return context.jsEnabled
        ? { kind: "resolved", type: { kind: "symbol" } }
        : { kind: "unsupported", reason: "TypeScript symbol values require the explicit JavaScript surface" };
    }
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
  const constantSubstitutions = new Map<string, MojoTargetConstArgument>();
  const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
  for (const [index, parameter] of row.sourceGenericParameters.entries()) {
    const sourceArgument = sourceArguments[index]!;
    if (parameter.targetKind !== "type") {
      return {
        kind: "unsupported",
        reason: `Mojo ${parameter.targetKind} parameter '${parameter.targetName}' requires exact source generic-value evidence`,
      };
    }
    const resolved = resolveMojoTargetTypeWithState(
      sourceArgument,
      authoredArguments.length === sourceArguments.length ? authoredArguments[index] : undefined,
      context,
      resolving,
    );
    if (resolved.kind === "unsupported") return resolved;
    typeSubstitutions.set(parameter.targetName, resolved.type);
  }
  return {
    kind: "resolved",
    type: substituteMojoTargetType(row.targetType, {
      types: typeSubstitutions,
      constants: constantSubstitutions,
    }),
  };
}

function resolveTypeParameter(
  symbol: ReturnType<SourceFileSemantics["declarations"]["typeSymbol"]>,
  context: MojoTypeResolutionContext,
): MojoTargetTypeRef | undefined {
  if (symbol === undefined) return undefined;
  const declarations = context.semantics.declarations.symbolDeclarations(symbol);
  if (declarations.length !== 1 || !context.ast.is.IsTypeParameterDeclaration(declarations[0])) {
    return undefined;
  }
  const name = context.ast.name(declarations[0]!);
  return name === undefined || !context.ast.is.IsIdentifier(name)
    ? undefined
    : Object.freeze({ kind: "type-parameter", name: context.ast.text(name) });
}

function resolveUnion(
  selectedType: Type,
  context: MojoTypeResolutionContext,
  resolving: Set<Type>,
): MojoTypeResolution {
  const members: MojoTargetTypeRef[] = [];
  for (const member of context.semantics.types.unionOrIntersectionTypes(selectedType)) {
    const resolved = resolveMojoTargetTypeWithState(member, undefined, context, resolving);
    if (resolved.kind === "unsupported") return resolved;
    if (!members.some((candidate) => mojoTargetTypeEquals(candidate, resolved.type))) {
      members.push(resolved.type);
    }
  }
  if (members.length === 0) {
    return { kind: "unsupported", reason: "the selected union has no retained members" };
  }
  if (members.length === 1) return { kind: "resolved", type: members[0]! };
  const undefinedIndex = members.findIndex((member) => member.kind === "undefined");
  if (members.length === 2 && undefinedIndex >= 0) {
    return {
      kind: "resolved",
      type: { kind: "optional", value: members[undefinedIndex === 0 ? 1 : 0]! },
    };
  }
  return { kind: "resolved", type: { kind: "union", members: Object.freeze(members) } };
}

function exactUndefinedType(type: Type, context: MojoTypeResolutionContext): boolean {
  const nonNullish = context.semantics.types.withoutMissingOrUndefined(type);
  return nonNullish !== undefined && context.semantics.types.isNever(nonNullish);
}

function namedType(
  id: string,
  modulePath: readonly string[],
  name: string,
  genericArguments: readonly MojoTargetTypeRef[] = [],
): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id,
    modulePath: Object.freeze([...modulePath]),
    name,
    ...(genericArguments.length === 0
      ? {}
      : {
          genericArguments: Object.freeze(genericArguments.map((type) =>
            Object.freeze({ kind: "type" as const, type }))),
        }),
  });
}

export function providerOwnerMatches(
  row: { readonly providerId: string; readonly providerVersion: string; readonly providerModuleId: string },
  identity: ProviderDeclarationIdentity,
): boolean {
  return row.providerId === identity.providerId &&
    row.providerVersion === identity.providerVersion &&
    row.providerModuleId === identity.providerModuleId;
}

function typeSubjects(
  type: Type,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
): readonly ExtensionFactSubject[] {
  const subjects: ExtensionFactSubject[] = [];
  if (authoredTypeNode !== undefined) {
    subjects.push(authoredTypeNode);
    if (context.ast.is.IsTypeReferenceNode(authoredTypeNode)) {
      const typeName = context.ast.as.AsTypeReferenceNode(authoredTypeNode)?.TypeName;
      if (typeName !== undefined) {
        subjects.push(typeName);
      }
    }
  }
  subjects.push(...context.semantics.facts.typeSubjects(type));
  return Object.freeze([...new Set(subjects)]);
}

function authoredTypeArguments(
  authoredTypeNode: Node | undefined,
  ast: AstReader,
): readonly Node[] {
  if (authoredTypeNode === undefined) return Object.freeze([]);
  if (ast.is.IsTypeReferenceNode(authoredTypeNode)) {
    return Object.freeze(ast.typeArguments(authoredTypeNode).filter((node): node is Node => node !== undefined));
  }
  const arrayElement = ArrayTypeNode_ElementType(ast, authoredTypeNode);
  return arrayElement === undefined ? Object.freeze([]) : Object.freeze([arrayElement]);
}

function authoredTupleElements(
  authoredTypeNode: Node | undefined,
  ast: AstReader,
): readonly Node[] {
  if (authoredTypeNode === undefined || !ast.is.IsTupleTypeNode(authoredTypeNode)) {
    return Object.freeze([]);
  }
  return Object.freeze(ast.elements(authoredTypeNode).flatMap((node) => {
    if (node === undefined) return [];
    if (ast.is.IsNamedTupleMember(node)) {
      const type = ast.as.AsNamedTupleMember(node)?.Type;
      return type === undefined ? [] : [type];
    }
    return [node];
  }));
}

function uniqueFact<T>(values: readonly (T | undefined)[]):
  { readonly kind: "selected"; readonly value: T | undefined } |
  { readonly kind: "conflict" } {
  const selected = values.filter((value): value is T => value !== undefined);
  if (selected.length === 0) return { kind: "selected", value: undefined };
  const first = selected[0];
  return selected.every((value) => closedFactEquals(value, first))
    ? { kind: "selected", value: selected[0] }
    : { kind: "conflict" };
}

function uniqueFixedArrayFact(
  values: readonly (import("@tsonic/source-core/facts").TsonicFixedArrayFact | undefined)[],
): { readonly kind: "selected"; readonly value: import("@tsonic/source-core/facts").TsonicFixedArrayFact | undefined } |
  { readonly kind: "conflict" } {
  const selected = values.filter((value): value is import("@tsonic/source-core/facts").TsonicFixedArrayFact =>
    value !== undefined);
  if (selected.length === 0) return { kind: "selected", value: undefined };
  const first = selected[0]!;
  return selected.every((value) =>
    value.elementType === first.elementType && value.length === first.length)
    ? { kind: "selected", value: first }
    : { kind: "conflict" };
}

function closedFactEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord).sort((a, b) => a.localeCompare(b, "en"));
  const rightKeys = Object.keys(rightRecord).sort((a, b) => a.localeCompare(b, "en"));
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] &&
      closedFactEquals(leftRecord[key], rightRecord[key]));
}

function uniqueProviderIdentity(
  values: readonly (ProviderDeclarationIdentity | undefined)[],
): { readonly kind: "selected"; readonly value: ProviderDeclarationIdentity | undefined } |
  { readonly kind: "conflict" } {
  const selected = values.filter(
    (value): value is ProviderDeclarationIdentity => value !== undefined,
  );
  if (selected.length === 0) return { kind: "selected", value: undefined };
  const first = selected[0]!;
  const compatible = selected.every((value) =>
    value.providerId === first.providerId &&
    value.providerVersion === first.providerVersion &&
    value.providerModuleId === first.providerModuleId &&
    (value.exportId === undefined || first.exportId === undefined || value.exportId === first.exportId));
  if (!compatible) return { kind: "conflict" };
  return {
    kind: "selected",
    value: Object.freeze({
      ...first,
      exportId: selected.find((value) => value.exportId !== undefined)?.exportId,
    }),
  };
}
