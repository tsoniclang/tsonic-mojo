import type { Node, Type } from "@tsonic/tsts";
import {
  providerVirtualDeclarationFactKey,
} from "@tsonic/tsts";
import type { MojoOriginRef } from "../../target-model/origins/model.js";
import {
  mojoSourceOriginTypeIds,
} from "../../source/semantics/declarations/origins.js";
import {
  mojoSourceProviderVersion,
  mojoSourceVirtualModulesProviderId,
  mojoTypesModule,
} from "../../source/semantics/identity.js";
import type { MojoTypeResolutionContext } from "./resolution.js";
import type { MojoSourceGenericParameterContext } from "../../source/semantics/generic-parameters.js";
import {
  typeSubjects,
  uniqueProviderIdentity,
} from "./resolution-helpers.js";

export type MojoSourceOriginTypeContract =
  | { readonly kind: "origin" }
  | { readonly kind: "static" }
  | { readonly kind: "inferred" }
  | { readonly kind: "untracked" }
  | { readonly kind: "unsafe" }
  | {
      readonly kind: "reference" | "mutable-reference";
      readonly valueTypeNode: Node;
      readonly originTypeNode?: Node;
    };

export function mojoSourceOriginTypeContract(
  selectedType: Type,
  authoredTypeNode: Node,
  context: MojoSourceGenericParameterContext,
): MojoSourceOriginTypeContract | undefined {
  if (context.ast.is.IsParenthesizedTypeNode(authoredTypeNode)) {
    const inner = context.ast.as.AsParenthesizedTypeNode(authoredTypeNode)?.Type;
    const innerType = inner === undefined ? undefined : context.semantics.types.authoredType(inner);
    return inner === undefined || innerType === undefined
      ? undefined
      : mojoSourceOriginTypeContract(innerType, inner, context);
  }
  if (!context.ast.is.IsTypeReferenceNode(authoredTypeNode)) return undefined;
  const identity = uniqueProviderIdentity(typeSubjects(selectedType, authoredTypeNode, context).map((subject) =>
    context.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey)));
  if (identity.kind === "conflict" || identity.value?.providerId !== mojoSourceVirtualModulesProviderId ||
    identity.value.providerVersion !== mojoSourceProviderVersion ||
    identity.value.providerModuleId !== mojoTypesModule ||
    identity.value.moduleSpecifier !== mojoTypesModule ||
    identity.value.exportId === undefined) {
    return undefined;
  }
  const arguments_ = context.ast.typeArguments(authoredTypeNode);
  if (arguments_.some((argument) => argument === undefined)) return undefined;
  const nodes = arguments_ as readonly Node[];
  switch (identity.value.exportId) {
    case mojoSourceOriginTypeIds.origin:
      return nodes.length === 0 ? Object.freeze({ kind: "origin" }) : undefined;
    case mojoSourceOriginTypeIds.staticOrigin:
      return nodes.length === 0 ? Object.freeze({ kind: "static" }) : undefined;
    case mojoSourceOriginTypeIds.inferredOrigin:
      return nodes.length === 0 ? Object.freeze({ kind: "inferred" }) : undefined;
    case mojoSourceOriginTypeIds.untrackedOrigin:
      return nodes.length === 0 ? Object.freeze({ kind: "untracked" }) : undefined;
    case mojoSourceOriginTypeIds.unsafeOrigin:
      return nodes.length === 0 ? Object.freeze({ kind: "unsafe" }) : undefined;
    case mojoSourceOriginTypeIds.reference:
    case mojoSourceOriginTypeIds.mutableReference:
      return nodes.length >= 1 && nodes.length <= 2
        ? Object.freeze({
            kind: identity.value.exportId === mojoSourceOriginTypeIds.reference
              ? "reference"
              : "mutable-reference",
            valueTypeNode: nodes[0]!,
            ...(nodes[1] === undefined ? {} : { originTypeNode: nodes[1] }),
          })
        : undefined;
    default:
      return undefined;
  }
}

export function resolveMojoSourceOrigin(
  node: Node | undefined,
  context: MojoTypeResolutionContext,
): MojoOriginRef | undefined {
  if (node === undefined) return Object.freeze({ kind: "inferred" });
  const selectedType = context.semantics.types.authoredType(node);
  if (selectedType === undefined) return undefined;
  const contract = mojoSourceOriginTypeContract(selectedType, node, context);
  switch (contract?.kind) {
    case "static": return Object.freeze({ kind: "static" });
    case "inferred": return Object.freeze({ kind: "inferred" });
    case "untracked": return Object.freeze({ kind: "untracked", mutable: false });
    case "unsafe": return Object.freeze({ kind: "unsafe", mutable: false });
    case "origin":
    case "reference":
    case "mutable-reference":
    case undefined:
      break;
  }
  const symbol = context.semantics.declarations.typeSymbol(selectedType);
  const declarations = symbol === undefined
    ? Object.freeze([])
    : context.semantics.declarations.symbolDeclarations(symbol);
  if (declarations.length !== 1 || !context.ast.is.IsTypeParameterDeclaration(declarations[0])) {
    return undefined;
  }
  const name = context.ast.name(declarations[0]!);
  return name === undefined || !context.ast.is.IsIdentifier(name)
    ? undefined
    : Object.freeze({ kind: "parameter", name: context.ast.text(name) });
}
