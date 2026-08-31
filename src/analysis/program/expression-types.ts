import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
} from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/provider/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { isMojoAssignmentOperator } from "./syntax-validation.js";

export function inferMojoExpressionType(
  node: Node,
  ast: AstReader,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  if (ast.is.IsParenthesizedExpression(node)) {
    const expression = Node_Expression(ast, node);
    return expression === undefined ? undefined : expressionTypes.get(expression);
  }
  if (!ast.is.IsBinaryExpression(node)) return expressionTypes.get(node);
  const binary = ast.as.AsBinaryExpression(node);
  const operator = ast.kindName(binary?.OperatorToken);
  if (isMojoAssignmentOperator(operator)) {
    const left = BinaryExpression_Left(ast, node);
    return left === undefined ? undefined : expressionTypes.get(left);
  }
  if (operator === "KindEqualsEqualsEqualsToken" ||
    operator === "KindExclamationEqualsEqualsToken" ||
    operator === "KindLessThanToken" || operator === "KindLessThanEqualsToken" ||
    operator === "KindGreaterThanToken" || operator === "KindGreaterThanEqualsToken" ||
    operator === "KindAmpersandAmpersandToken" || operator === "KindBarBarToken") {
    return Object.freeze({ kind: "source-primitive", name: "bool" });
  }
  const leftNode = BinaryExpression_Left(ast, node);
  const rightNode = BinaryExpression_Right(ast, node);
  if (leftNode === undefined || rightNode === undefined) return expressionTypes.get(node);
  const left = expressionTypes.get(leftNode);
  const right = expressionTypes.get(rightNode);
  if (left !== undefined && right !== undefined && mojoTargetTypeEquals(left, right)) return left;
  if (left !== undefined && ast.is.IsNumericLiteral(rightNode) && isNumericCarrier(left)) return left;
  if (right !== undefined && ast.is.IsNumericLiteral(leftNode) && isNumericCarrier(right)) return right;
  return expressionTypes.get(node);
}

export function isMojoExpressionNode(node: Node, ast: AstReader): boolean {
  return ast.is.IsIdentifier(node) || ast.is.IsStringLiteral(node) ||
    ast.is.IsNoSubstitutionTemplateLiteral(node) || ast.is.IsNumericLiteral(node) ||
    ast.is.IsBinaryExpression(node) || ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node) ||
    ast.is.IsPropertyAccessExpression(node) ||
    ast.is.IsParenthesizedExpression(node) ||
    ast.kindName(node) === "KindThisKeyword" || ast.kindName(node) === "KindNullKeyword" ||
    ast.kindName(node) === "KindTrueKeyword" || ast.kindName(node) === "KindFalseKeyword";
}

function isNumericCarrier(type: MojoTargetTypeRef): boolean {
  return type.kind === "source-primitive" && type.name !== "bool" && type.name !== "char";
}
