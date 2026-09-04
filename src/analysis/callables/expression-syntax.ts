import type { Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function callableExpressionDeclaration(
  expression: Node,
  source: TargetSourceProgram,
): Node | undefined {
  const { ast } = source;
  let current = expression;
  while (true) {
    const parent = ast.parent(current);
    if (parent === undefined) return undefined;
    if (Node_Initializer(ast, parent) === current) return parent;
    if (!isTransparentExpression(parent, ast) || Node_Expression(ast, parent) !== current) {
      return undefined;
    }
    current = parent;
  }
}

export function unwrapCallableExpression(
  expression: Node,
  source: TargetSourceProgram,
): Node {
  const { ast } = source;
  let current = expression;
  while (isTransparentExpression(current, ast)) {
    const inner = Node_Expression(ast, current);
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}

function isTransparentExpression(
  node: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  return ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsTypeAssertion(node) || ast.is.IsNonNullExpression(node) ||
    ast.is.IsSatisfiesExpression(node);
}

export function captureEligibleDeclaration(
  declaration: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  return ast.is.IsVariableDeclaration(declaration) ||
    ast.is.IsParameterDeclaration(declaration) ||
    ast.is.IsBindingElement(declaration);
}

export function nodeIsWithin(
  node: Node,
  ancestor: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = ast.parent(current);
  }
  return false;
}

export function isNestedCallable(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node) ||
    ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
    ast.is.IsSetAccessorDeclaration(node);
}
