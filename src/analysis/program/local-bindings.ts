import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { walkSourceTree } from "./traversal.js";

export function allocateMojoLocalBindings(
  body: Node,
  allocate: (name: string) => string,
  bindings: WeakMap<Node, string>,
  ast: AstReader,
  diagnostics: TargetDiagnostic[],
  bindingSourceFiles: WeakMap<Node, SourceFile>,
): void {
  walkSourceTree(body, ast, (node): void => {
    if (!ast.is.IsVariableDeclaration(node)) return;
    const nameNode = ast.name(node);
    if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
      diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_BINDING_PATTERN_UNSUPPORTED",
        "Mojo foundation currently requires simple identifier variable bindings.",
        node,
      ));
      return;
    }
    bindings.set(node, allocate(ast.text(nameNode)));
    const sourceFile = ast.getSourceFile(node);
    if (sourceFile !== undefined) bindingSourceFiles.set(node, sourceFile);
  }, (node, root) => node === root || !isCallableBoundary(node, ast));
}

function isCallableBoundary(node: Node, ast: AstReader): boolean {
  return ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) ||
    ast.is.IsArrowFunction(node) ||
    ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) ||
    ast.is.IsSetAccessorDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node);
}
