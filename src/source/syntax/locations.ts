import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";

export function mojoLocationExpression(node: Node, ast: AstReader): Node {
  let current = node;
  while (ast.is.IsParenthesizedExpression(current)) {
    const inner = Node_Expression(ast, current);
    if (inner === undefined) throw new Error("A checked parenthesized location must have an expression.");
    current = inner;
  }
  return current;
}
