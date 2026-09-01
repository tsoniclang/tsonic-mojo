import type {
  AstReader,
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  Type,
} from "@tsonic/tsts";
import { ArrayTypeNode_ElementType } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoTypeResolution, MojoTypeResolutionContext } from "./resolution.js";

export function resolveTypeParameter(
  symbol: ReturnType<MojoTypeResolutionContext["semantics"]["declarations"]["typeSymbol"]>,
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

export function resolveUnion(
  selectedType: Type,
  context: MojoTypeResolutionContext,
  resolveMember: (member: Type) => MojoTypeResolution,
): MojoTypeResolution {
  const members: MojoTargetTypeRef[] = [];
  for (const member of context.semantics.types.unionOrIntersectionTypes(selectedType)) {
    const resolved = resolveMember(member);
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

export function exactUndefinedType(type: Type, context: MojoTypeResolutionContext): boolean {
  const nonNullish = context.semantics.types.withoutMissingOrUndefined(type);
  return nonNullish !== undefined && context.semantics.types.isNever(nonNullish);
}

export function namedType(
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

export function typeSubjects(
  type: Type,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
): readonly ExtensionFactSubject[] {
  const subjects: ExtensionFactSubject[] = [];
  if (authoredTypeNode !== undefined) {
    subjects.push(authoredTypeNode);
    if (context.ast.is.IsTypeReferenceNode(authoredTypeNode)) {
      const typeName = context.ast.as.AsTypeReferenceNode(authoredTypeNode)?.TypeName;
      if (typeName !== undefined) subjects.push(typeName);
    }
  }
  subjects.push(...context.semantics.facts.typeSubjects(type));
  return Object.freeze([...new Set(subjects)]);
}

export function authoredTypeArguments(
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

export function authoredTupleElements(
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

export function resolveSourceProfileTypeArguments(
  selectedType: Type,
  authoredTypeNode: Node | undefined,
  expectedCount: number,
  context: MojoTypeResolutionContext,
  resolve: (type: Type, authoredTypeNode: Node | undefined) => MojoTypeResolution,
): { readonly kind: "resolved"; readonly types: readonly MojoTargetTypeRef[] } |
  { readonly kind: "unsupported"; readonly reason: string } {
  const sourceArguments = context.semantics.types.effectiveTypeArguments(selectedType) ??
    context.semantics.types.typeArguments(selectedType);
  if (sourceArguments.length !== expectedCount) {
    return {
      kind: "unsupported",
      reason: `selected source-profile type has ${sourceArguments.length} arguments for ${expectedCount} target parameters`,
    };
  }
  const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
  const types: MojoTargetTypeRef[] = [];
  for (const [index, sourceArgument] of sourceArguments.entries()) {
    const resolved = resolve(
      sourceArgument,
      authoredArguments.length === sourceArguments.length ? authoredArguments[index] : undefined,
    );
    if (resolved.kind === "unsupported") return resolved;
    types.push(resolved.type);
  }
  return { kind: "resolved", types: Object.freeze(types) };
}

export function uniqueFact<T>(values: readonly (T | undefined)[]):
  { readonly kind: "selected"; readonly value: T | undefined } |
  { readonly kind: "conflict" } {
  const selected = values.filter((value): value is T => value !== undefined);
  if (selected.length === 0) return { kind: "selected", value: undefined };
  const first = selected[0];
  return selected.every((value) => closedFactEquals(value, first))
    ? { kind: "selected", value: selected[0] }
    : { kind: "conflict" };
}

export function uniqueFixedArrayFact(
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

export function uniqueProviderIdentity(
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
