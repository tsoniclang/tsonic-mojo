import type { AstReader, Node } from "@tsonic/tsts";

export function collectMojoDeferredExpression(
  node: Node,
  ast: AstReader,
  collections: {
    readonly templateExpressionNodes: Set<Node>;
    readonly awaitExpressionNodes: Set<Node>;
  },
): void {
  if (ast.kindName(node) === "KindTemplateExpression") {
    collections.templateExpressionNodes.add(node);
  }
  if (ast.is.IsAwaitExpression(node)) {
    collections.awaitExpressionNodes.add(node);
  }
}
