import type { AstReader, Node } from "@tsonic/tsts";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
} from "../../target-model/types/model.js";
import type { MojoTypeResolutionContext } from "./resolution.js";
import { resolveMojoSourceOrigin } from "./origins.js";
import {
  classifyMojoSourceGenericParameter,
  mojoSourceGenericParameterOwner,
} from "../../source/semantics/generic-parameters.js";

type MojoValueGenericArgumentContext = Pick<
  MojoTypeResolutionContext,
  "ast" | "semantics" | "sourceFacts"
>;

export function resolveMojoNonTypeGenericArguments(
  parameter: MojoProviderTargetGenericParameter,
  node: Node,
  context: MojoTypeResolutionContext,
): readonly MojoTargetGenericArgument[] | undefined {
  if (parameter.kind === "type") return undefined;
  const { ast } = context;
  if (parameter.variadic && ast.is.IsTupleTypeNode(node)) {
    const elements = ast.elements(node);
    if (elements.some((element) => element === undefined)) return undefined;
    const result = (elements as readonly Node[]).map((element) =>
      parameter.kind === "origin"
        ? resolveOriginGenericArgument(element, context)
        : resolveMojoValueGenericArgument(element, context));
    return result.some((argument) => argument === undefined)
      ? undefined
      : Object.freeze(result as MojoTargetGenericArgument[]);
  }
  const value = parameter.kind === "origin"
    ? resolveOriginGenericArgument(node, context)
    : resolveMojoValueGenericArgument(node, context);
  return value === undefined ? undefined : Object.freeze([value]);
}

function resolveOriginGenericArgument(
  node: Node,
  context: MojoTypeResolutionContext,
): MojoTargetGenericArgument | undefined {
  const origin = resolveMojoSourceOrigin(node, context);
  return origin === undefined ? undefined : Object.freeze({ kind: "origin", origin });
}

export function resolveMojoValueGenericArgument(
  node: Node,
  input: AstReader | MojoValueGenericArgumentContext,
): MojoTargetGenericArgument | undefined {
  const ast = isValueGenericArgumentContext(input) ? input.ast : input;
  const literal = ast.is.IsLiteralTypeNode(node)
    ? ast.as.AsLiteralTypeNode(node)?.Literal
    : node;
  if (literal === undefined) return undefined;
  const kind = ast.kindName(literal);
  if (kind === "KindTrueKeyword" || kind === "KindFalseKeyword") {
    return Object.freeze({ kind: "boolean", value: kind === "KindTrueKeyword" });
  }
  if (ast.is.IsStringLiteral(literal)) {
    return Object.freeze({ kind: "static-string", value: ast.text(literal) });
  }
  if (ast.is.IsNumericLiteral(literal)) {
    const text = ast.text(literal).replace(/_/gu, "");
    return /^\d+$/u.test(text)
      ? Object.freeze({ kind: "integer", value: BigInt(text).toString(10) })
      : undefined;
  }
  if (!ast.is.IsPrefixUnaryExpression(literal)) {
    return isValueGenericArgumentContext(input)
      ? resolveCompileTimeValueParameter(node, input)
      : undefined;
  }
  const unary = ast.as.AsPrefixUnaryExpression(literal);
  const operand = unary?.Operand;
  if (operand === undefined || !ast.is.IsNumericLiteral(operand)) return undefined;
  const text = ast.text(operand).replace(/_/gu, "");
  if (!/^\d+$/u.test(text)) return undefined;
  const value = BigInt(text);
  const operator = ast.operatorKindName(literal);
  if (operator === "KindMinusToken") {
    return Object.freeze({ kind: "integer", value: (-value).toString(10) });
  }
  return operator === "KindPlusToken"
    ? Object.freeze({ kind: "integer", value: value.toString(10) })
    : undefined;
}

function resolveCompileTimeValueParameter(
  node: Node,
  context: MojoValueGenericArgumentContext,
): MojoTargetGenericArgument | undefined {
  const selectedType = context.semantics.types.authoredType(node);
  const symbol = selectedType === undefined
    ? undefined
    : context.semantics.declarations.typeAliasSymbol(selectedType) ??
      context.semantics.declarations.typeSymbol(selectedType);
  const declarations = symbol === undefined
    ? Object.freeze([])
    : context.semantics.declarations.symbolDeclarations(symbol);
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (declaration === undefined || !context.ast.is.IsTypeParameterDeclaration(declaration)) {
    return undefined;
  }
  const owner = mojoSourceGenericParameterOwner(declaration, context);
  const classification = owner === undefined
    ? undefined
    : classifyMojoSourceGenericParameter(owner, declaration, context);
  return classification?.kind === "resolved" && classification.parameter.kind === "value"
    ? Object.freeze({
        kind: "value-reference",
        path: Object.freeze([classification.parameter.name]),
      })
    : undefined;
}

function isValueGenericArgumentContext(
  input: AstReader | MojoValueGenericArgumentContext,
): input is MojoValueGenericArgumentContext {
  return "semantics" in input && "sourceFacts" in input;
}
