import { pointerOperationFactKey } from "@tsonic/tsts";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { walkSourceTree } from "./traversal.js";

export function collectMojoAddressedStorageDeclarations(
  sourceFiles: readonly SourceFile[],
  source: TargetSourceProgram,
): ReadonlySet<Node> {
  const declarations = new Set<Node>();
  for (const sourceFile of sourceFiles) {
    walkSourceTree(sourceFile, source.ast, (node): void => {
      if (!source.ast.is.IsCallExpression(node)) return;
      const fact = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (fact?.operation !== "address-of" || fact.call !== node ||
        fact.storageDeclaration === undefined ||
        !source.ast.is.IsIdentifier(fact.storageExpression)) return;
      const reference = source.navigation.sourceReferenceFor(fact.storageExpression);
      if (reference?.project !== true || reference.declaration !== fact.storageDeclaration ||
        !isFunctionLocalStorageDeclaration(fact.storageDeclaration, source.ast)) return;
      declarations.add(fact.storageDeclaration);
    });
  }
  return declarations;
}

function isFunctionLocalStorageDeclaration(
  declaration: Node,
  ast: AstReader,
): boolean {
  if (!ast.is.IsVariableDeclaration(declaration) && !ast.is.IsParameterDeclaration(declaration)) {
    return false;
  }
  let owner = ast.parent(declaration);
  while (owner !== undefined) {
    if (ast.is.IsFunctionDeclaration(owner) || ast.is.IsMethodDeclaration(owner) ||
      ast.is.IsConstructorDeclaration(owner) || ast.is.IsGetAccessorDeclaration(owner) ||
      ast.is.IsSetAccessorDeclaration(owner)) return true;
    if (ast.is.IsArrowFunction(owner) || ast.is.IsFunctionExpression(owner) ||
      ast.is.IsSourceFile(owner)) return false;
    owner = ast.parent(owner);
  }
  return false;
}
