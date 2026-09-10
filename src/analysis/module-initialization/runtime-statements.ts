import type { AstReader, Node } from "@tsonic/tsts";

export function isMojoModuleRuntimeStatement(node: Node, ast: AstReader): boolean {
  return ast.is.IsBlock(node) || ast.is.IsIfStatement(node) ||
    ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node) ||
    ast.is.IsForStatement(node) || ast.is.IsForOfStatement(node) ||
    ast.is.IsForInStatement(node) || ast.is.IsSwitchStatement(node) ||
    ast.is.IsTryStatement(node) || ast.is.IsThrowStatement(node) ||
    ast.is.IsDebuggerStatement(node);
}
