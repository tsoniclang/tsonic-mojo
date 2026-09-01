import { tsonicUnsafeContextFactKey } from "@tsonic/source-core/facts";
import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function hasExplicitUnsafeContext(
  operation: Node,
  source: TargetSourceProgram,
): boolean {
  let current: Node | undefined = operation;
  let crossedCallableBoundary = false;
  while (current !== undefined) {
    const unsafe = source.sourceFacts.getFact(current, tsonicUnsafeContextFactKey);
    if (unsafe?.kind === "expression" && !crossedCallableBoundary &&
      contains(unsafe.expression, operation, source)) return true;

    const parent = source.ast.parent(current);
    if (parent === undefined) break;
    crossedCallableBoundary ||= isCallableBoundary(parent, source);
    if (!crossedCallableBoundary && blockUnsafeMarker(parent, current, source)) return true;
    current = parent;
  }
  return false;
}

function blockUnsafeMarker(
  parent: Node,
  descendant: Node,
  source: TargetSourceProgram,
): boolean {
  if (!source.ast.is.IsBlock(parent)) return false;
  const statements = source.ast.statements(parent).filter((node): node is Node => node !== undefined);
  if (statements.length < 2) return false;
  const first = statements[0]!;
  if (!source.ast.is.IsExpressionStatement(first)) return false;
  const marker = source.ast.as.AsExpressionStatement(first)?.Expression;
  const fact = marker === undefined
    ? undefined
    : source.sourceFacts.getFact(marker, tsonicUnsafeContextFactKey);
  if (fact?.kind !== "remaining-block") return false;
  return statements.slice(1).some((statement) => contains(statement, descendant, source));
}

function contains(
  ancestor: Node,
  descendant: Node,
  source: TargetSourceProgram,
): boolean {
  let current: Node | undefined = descendant;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = source.ast.parent(current);
  }
  return false;
}

function isCallableBoundary(
  node: Node,
  source: TargetSourceProgram,
): boolean {
  return source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsMethodDeclaration(node) ||
    source.ast.is.IsConstructorDeclaration(node) ||
    source.ast.is.IsGetAccessorDeclaration(node) ||
    source.ast.is.IsSetAccessorDeclaration(node);
}
