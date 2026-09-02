import type { AstReader, Node } from "@tsonic/tsts";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
} from "../../target-model/types/model.js";

export function resolveMojoNonTypeGenericArguments(
  parameter: MojoProviderTargetGenericParameter,
  node: Node,
  ast: AstReader,
): readonly MojoTargetGenericArgument[] | undefined {
  if (parameter.kind !== "value") return undefined;
  if (parameter.variadic && ast.is.IsTupleTypeNode(node)) {
    const elements = ast.elements(node);
    if (elements.some((element) => element === undefined)) return undefined;
    const result = (elements as readonly Node[]).map((element) =>
      resolveMojoValueGenericArgument(element, ast));
    return result.some((argument) => argument === undefined)
      ? undefined
      : Object.freeze(result as MojoTargetGenericArgument[]);
  }
  const value = resolveMojoValueGenericArgument(node, ast);
  return value === undefined ? undefined : Object.freeze([value]);
}

export function resolveMojoValueGenericArgument(
  node: Node,
  ast: AstReader,
): MojoTargetGenericArgument | undefined {
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
  if (!ast.is.IsPrefixUnaryExpression(literal)) return undefined;
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
