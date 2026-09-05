import type { AstReader, Node } from "@tsonic/tsts";

export function walkSourceTree(
  root: Node,
  ast: AstReader,
  visit: (node: Node) => void,
  descend: (node: Node, root: Node) => boolean = () => true,
): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    if (!descend(node, root)) continue;
    const children = ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push(child);
    }
  }
}

export function walkSourceTreePostOrder(
  root: Node,
  ast: AstReader,
  visit: (node: Node) => void,
  descend: (node: Node, root: Node) => boolean = () => true,
): void {
  const stack: { readonly node: Node; readonly visited: boolean }[] = [
    { node: root, visited: false },
  ];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.visited) {
      visit(entry.node);
      continue;
    }
    stack.push({ node: entry.node, visited: true });
    if (!descend(entry.node, root)) continue;
    const children = ast.children(entry.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push({ node: child, visited: false });
    }
  }
}
