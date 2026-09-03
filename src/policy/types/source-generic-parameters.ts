import { tsonicCompileTimeFactKey } from "@tsonic/source-core/facts";
import type {
  AstReader,
  Node,
  ReadonlySourceFactResolver,
  Type,
} from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import { walkSourceTree } from "../../analysis/program/traversal.js";
import { mojoSourceOriginTypeContract } from "./origins.js";

export interface MojoSourceGenericParameterContext {
  readonly ast: AstReader;
  readonly semantics: SourceFileSemantics;
  readonly sourceFacts: ReadonlySourceFactResolver;
}

export type MojoSourceGenericParameterKind = "type" | "value" | "origin";

export interface MojoSourceGenericParameterIdentity {
  readonly declaration: Node;
  readonly name: string;
  readonly kind: MojoSourceGenericParameterKind;
}

export type MojoSourceGenericParameterClassification =
  | { readonly kind: "resolved"; readonly parameter: MojoSourceGenericParameterIdentity }
  | { readonly kind: "unsupported"; readonly reason: string };

export function classifyMojoSourceGenericParameter(
  owner: Node,
  declaration: Node,
  context: MojoSourceGenericParameterContext,
): MojoSourceGenericParameterClassification {
  const { ast } = context;
  if (!ast.is.IsTypeParameterDeclaration(declaration)) {
    return unsupported("the source declaration is not a TypeScript type parameter");
  }
  const syntax = ast.as.AsTypeParameterDeclaration(declaration);
  const nameNode = ast.name(declaration);
  if (syntax === undefined || nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
    return unsupported("the source type parameter has no exact identifier declaration");
  }
  const declaredType = context.semantics.declarations.declaredType(declaration);
  if (declaredType === undefined) {
    return unsupported("the checker supplied no exact semantic type for the source type parameter");
  }
  const origin = sourceOriginConstraint(syntax.Constraint, context);
  const projected = hasExactCompileTimeProjection(owner, declaredType, context);
  if (origin && projected) {
    return unsupported("an origin parameter cannot also be selected as a compile-time value parameter");
  }
  return {
    kind: "resolved",
    parameter: Object.freeze({
      declaration,
      name: ast.text(nameNode),
      kind: origin ? "origin" : projected ? "value" : "type",
    }),
  };
}

export function mojoSourceGenericParameterOwner(
  declaration: Node,
  context: Pick<MojoSourceGenericParameterContext, "ast">,
): Node | undefined {
  let current = context.ast.parent(declaration);
  while (current !== undefined) {
    if (context.ast.typeParameters(current).some((parameter) => parameter === declaration)) {
      return current;
    }
    current = context.ast.parent(current);
  }
  return undefined;
}

function sourceOriginConstraint(
  constraint: Node | undefined,
  context: MojoSourceGenericParameterContext,
): boolean {
  if (constraint === undefined) return false;
  const selected = context.semantics.types.authoredType(constraint);
  return selected !== undefined &&
    mojoSourceOriginTypeContract(selected, constraint, context)?.kind === "origin";
}

function hasExactCompileTimeProjection(
  owner: Node,
  parameterType: Type,
  context: MojoSourceGenericParameterContext,
): boolean {
  let selected = false;
  walkSourceTree(owner, context.ast, (node): void => {
    if (selected) return;
    const fact = context.sourceFacts.getFact(node, tsonicCompileTimeFactKey);
    selected = fact?.kind === "type" &&
      context.semantics.types.isIdentical(fact.selectedType, parameterType);
  });
  return selected;
}

function unsupported(reason: string): MojoSourceGenericParameterClassification {
  return { kind: "unsupported", reason };
}
