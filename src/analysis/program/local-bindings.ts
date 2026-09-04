import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";

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
    if (nameNode === undefined) {
      diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_BINDING_NAME_MISSING",
        "A local declaration requires one exact authored binding name.",
        node,
      ));
      return;
    }
    const sourceFile = ast.getSourceFile(node);
    if (ast.is.IsIdentifier(nameNode)) {
      bind(node, nameNode, sourceFile, allocate, bindings, bindingSourceFiles, ast);
      return;
    }
    if (ast.is.IsArrayBindingPattern(nameNode) || ast.is.IsObjectBindingPattern(nameNode)) {
      const rootName = allocate("binding");
      bindings.set(node, rootName);
      if (sourceFile !== undefined) bindingSourceFiles.set(node, sourceFile);
      allocateMojoBindingPatternNames(
        nameNode,
        sourceFile,
        allocate,
        bindings,
        bindingSourceFiles,
        ast,
        diagnostics,
      );
      return;
    }
    diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_BINDING_NAME_UNSUPPORTED",
      `Local binding kind '${ast.kindName(nameNode)}' has no exact Mojo binding representation.`,
      nameNode,
    ));
  }, (node, root) => node === root || !isCallableBoundary(node, ast));
}

export function allocateMojoBindingPatternNames(
  pattern: Node,
  sourceFile: SourceFile | undefined,
  allocate: (name: string) => string,
  bindings: WeakMap<Node, string>,
  bindingSourceFiles: WeakMap<Node, SourceFile> | undefined,
  ast: AstReader,
  diagnostics: TargetDiagnostic[],
): void {
  const arrayPattern = ast.is.IsArrayBindingPattern(pattern);
  for (const element of ast.elements(pattern)) {
    if (element === undefined || ast.is.IsOmittedExpression(element)) continue;
    if (!ast.is.IsBindingElement(element)) {
      diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_BINDING_ELEMENT_UNSUPPORTED",
        `Binding pattern element '${ast.kindName(element)}' is not one exact binding declaration.`,
        element,
      ));
      continue;
    }
    const name = ast.name(element);
    if (arrayPattern && name === undefined) continue;
    if (name === undefined) {
      diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_BINDING_NAME_MISSING",
        "A binding pattern element requires one exact authored binding name.",
        element,
      ));
      continue;
    }
    if (ast.is.IsIdentifier(name)) {
      bind(element, name, sourceFile, allocate, bindings, bindingSourceFiles, ast);
      continue;
    }
    if (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name)) {
      allocateMojoBindingPatternNames(
        name,
        sourceFile,
        allocate,
        bindings,
        bindingSourceFiles,
        ast,
        diagnostics,
      );
      continue;
    }
    diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_BINDING_NAME_UNSUPPORTED",
      `Binding pattern target '${ast.kindName(name)}' has no exact Mojo binding representation.`,
      name,
    ));
  }
}

function bind(
  declaration: Node,
  nameNode: Node,
  sourceFile: SourceFile | undefined,
  allocate: (name: string) => string,
  bindings: WeakMap<Node, string>,
  bindingSourceFiles: WeakMap<Node, SourceFile> | undefined,
  ast: AstReader,
): void {
  const name = allocate(ast.text(nameNode));
  bindings.set(declaration, name);
  bindings.set(nameNode, name);
  if (sourceFile !== undefined && bindingSourceFiles !== undefined) {
    bindingSourceFiles.set(declaration, sourceFile);
    bindingSourceFiles.set(nameNode, sourceFile);
  }
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
