import {
  providerVirtualDeclarationFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  SourcePrimitiveFact,
  Type,
} from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";

export interface MojoTypeResolutionContext {
  readonly semantics: SourceFileSemantics;
  readonly sourceFacts: import("@tsonic/tsts").ReadonlySourceFactResolver;
  readonly providerSemantics: MojoProviderSemantics;
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
  if (selectedType === undefined) {
    return { kind: "unsupported", reason: "the TypeScript checker supplied no selected type" };
  }
  const subjects = typeSubjects(selectedType, authoredTypeNode, context);
  const primitive = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, sourcePrimitiveFactKey)),
  );
  if (primitive.kind === "conflict") {
    return { kind: "unsupported", reason: "selected source primitive facts conflict" };
  }
  if (primitive.value !== undefined) {
    return supportedPrimitive(primitive.value);
  }
  const provider = uniqueProviderIdentity(
    subjects.map((subject) => context.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey)),
  );
  if (provider.kind === "conflict") {
    return { kind: "unsupported", reason: "selected provider type identities conflict" };
  }
  if (provider.value !== undefined) {
    const candidates = context.providerSemantics.types.filter((row) =>
      providerOwnerMatches(row, provider.value!) &&
      row.exportId === provider.value!.exportId);
    if (candidates.length !== 1) {
      return {
        kind: "unsupported",
        reason: `selected provider type has ${candidates.length} Mojo carrier relations`,
      };
    }
    return { kind: "resolved", type: candidates[0]!.targetType };
  }
  const types = context.semantics.types;
  if (types.isVoidLike(selectedType)) return { kind: "resolved", type: { kind: "unit" } };
  if (types.isBooleanLike(selectedType)) {
    return { kind: "resolved", type: { kind: "source-primitive", name: "bool" } };
  }
  if (types.isStringLike(selectedType)) {
    return context.jsEnabled
      ? {
          kind: "resolved",
          type: {
            kind: "target-named",
            id: "tsonic.mojo.js.JsString",
            modulePath: Object.freeze(["tsonic_js"]),
            name: "JsString",
          },
        }
      : { kind: "resolved", type: { kind: "native-string" } };
  }
  if (types.isNumberLike(selectedType)) {
    return { kind: "resolved", type: { kind: "source-primitive", name: "float64" } };
  }
  if (types.isArrayLike(selectedType)) {
    const arguments_ = types.effectiveTypeArguments(selectedType) ?? types.typeArguments(selectedType);
    const element = arguments_[0];
    const resolvedElement = resolveMojoTargetType(element, undefined, context);
    if (resolvedElement.kind === "unsupported") return resolvedElement;
    return context.jsEnabled
      ? {
          kind: "resolved",
          type: {
            kind: "target-named",
            id: "tsonic.mojo.js.JsArray",
            modulePath: Object.freeze(["tsonic_js"]),
            name: "JsArray",
            genericArguments: Object.freeze([Object.freeze({ kind: "type" as const, type: resolvedElement.type })]),
          },
        }
      : { kind: "resolved", type: { kind: "list", element: resolvedElement.type } };
  }
  return {
    kind: "unsupported",
    reason: "the selected TypeScript type has no exact Mojo carrier relation",
  };
}

export function mojoTypeEquals(left: MojoTargetTypeRef, right: MojoTargetTypeRef): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "source-primitive":
      return right.kind === "source-primitive" && left.name === right.name;
    case "native-string":
    case "unit":
      return true;
    case "type-parameter":
      return right.kind === "type-parameter" && left.name === right.name;
    case "target-named":
      return right.kind === "target-named" &&
        left.id === right.id &&
        left.name === right.name &&
        arrayEquals(left.modulePath, right.modulePath, (a, b) => a === b) &&
        genericArgumentsEqual(left.genericArguments ?? [], right.genericArguments ?? []);
    case "list":
      return right.kind === "list" && mojoTypeEquals(left.element, right.element);
    case "optional":
      return right.kind === "optional" && mojoTypeEquals(left.value, right.value);
    case "tuple":
      return right.kind === "tuple" &&
        arrayEquals(left.elements, right.elements, mojoTypeEquals);
    case "reference":
      return right.kind === "reference" && left.origin === right.origin &&
        mojoTypeEquals(left.value, right.value);
    case "function":
      return right.kind === "function" && left.thin === right.thin &&
        left.raises === right.raises &&
        arrayEquals(left.parameters, right.parameters, mojoTypeEquals) &&
        mojoTypeEquals(left.result, right.result);
  }
}

function genericArgumentsEqual(
  left: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[],
  right: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[],
): boolean {
  return left.length === right.length && left.every((argument, index) => {
    const other = right[index];
    if (other === undefined || argument.kind !== other.kind) return false;
    switch (argument.kind) {
      case "type": return other.kind === "type" && mojoTypeEquals(argument.type, other.type);
      case "value": return other.kind === "value" && argument.expression === other.expression;
      case "unbound": return true;
    }
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

function supportedPrimitive(fact: SourcePrimitiveFact): MojoTypeResolution {
  switch (fact.kind) {
    case "bool":
    case "char":
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "int64":
    case "uint64":
    case "native-int":
    case "native-uint":
    case "float16":
    case "float32":
    case "float64":
      return { kind: "resolved", type: { kind: "source-primitive", name: fact.kind } };
    case "decimal":
    case "int128":
    case "uint128":
      return {
        kind: "unsupported",
        reason: `Mojo has no certified native carrier for source primitive '${fact.kind}'`,
      };
  }
}

function typeSubjects(
  type: Type,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
): readonly ExtensionFactSubject[] {
  const subjects: ExtensionFactSubject[] = [];
  if (authoredTypeNode !== undefined) {
    subjects.push(authoredTypeNode, ...context.semantics.facts.authoredTypeSubjects(authoredTypeNode));
  }
  subjects.push(...context.semantics.facts.typeSubjects(type));
  return Object.freeze([...new Set(subjects)]);
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

function closedFactEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord).sort((a, b) => a.localeCompare(b, "en"));
  const rightKeys = Object.keys(rightRecord).sort((a, b) => a.localeCompare(b, "en"));
  return arrayEquals(leftKeys, rightKeys, (a, b) => a === b) &&
    leftKeys.every((key) => closedFactEquals(leftRecord[key], rightRecord[key]));
}

function arrayEquals<T>(
  left: readonly T[],
  right: readonly T[],
  equals: (left: T, right: T) => boolean,
): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return other !== undefined && equals(value, other);
  });
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
