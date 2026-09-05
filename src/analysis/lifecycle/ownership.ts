import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type {
  MojoCallSelection,
  MojoObjectLiteralSelection,
} from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueOwnership } from "../../target-model/lifecycle/model.js";

export interface MojoValueOwnershipResolverInput {
  readonly source: TargetSourceProgram;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
}

export function createMojoValueOwnershipResolver(
  input: MojoValueOwnershipResolverInput,
): (expression: Node) => MojoValueOwnership {
  return (expression): MojoValueOwnership => {
    const node = unwrapExpression(expression, input.source);
    const type = input.expressionTypes.get(node) ?? input.expressionTypes.get(expression);
    if (type?.kind === "reference") return "borrowed";
    if (input.callSelections.has(node) || input.objectLiteralSelections.has(node)) return "fresh";
    if (input.source.ast.is.IsArrayLiteralExpression(node)) return "fresh";
    return "stable";
  };
}

function unwrapExpression(expression: Node, source: TargetSourceProgram): Node {
  const { ast } = source;
  let current = expression;
  while (ast.is.IsParenthesizedExpression(current) || ast.is.IsAsExpression(current) ||
    ast.is.IsTypeAssertion(current) || ast.is.IsNonNullExpression(current) ||
    ast.is.IsSatisfiesExpression(current)) {
    const inner = Node_Expression(ast, current);
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}
