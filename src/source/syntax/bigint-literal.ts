import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, PrefixUnaryExpression_Operand } from "@tsonic/target-api/source";

export function sourceBigIntLiteral(ast: AstReader, expression: Node): bigint | undefined {
  if (ast.is.IsParenthesizedExpression(expression)) {
    const inner = Node_Expression(ast, expression);
    return inner === undefined ? undefined : sourceBigIntLiteral(ast, inner);
  }
  if (ast.is.IsPrefixUnaryExpression(expression) &&
    ast.operatorKindName(expression) === "KindMinusToken") {
    const operand = PrefixUnaryExpression_Operand(ast, expression);
    const value = operand === undefined ? undefined : sourceBigIntLiteral(ast, operand);
    return value === undefined ? undefined : -value;
  }
  if (!ast.is.IsBigIntLiteral(expression)) return undefined;
  const text = ast.text(expression);
  return text.endsWith("n") ? BigInt(text.slice(0, -1).replace(/_/gu, "")) : undefined;
}
