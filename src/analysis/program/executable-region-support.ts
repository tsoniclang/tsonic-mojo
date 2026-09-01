import type { Node, Type } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import type { MojoExecutableRegionAnalysisInput } from "./executable-regions.js";

export function descendWithinExecutableRegion(
  node: Node,
  root: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  if (node === root) return true;
  return !isCallableBoundary(node, ast);
}

export function resolveExecutableRegionType(
  type: Type | undefined,
  authoredTypeNode: Node | undefined,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(type, authoredTypeNode, {
    ast: input.source.ast,
    semantics,
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
  });
  return resolved.kind === "resolved" ? resolved.type : undefined;
}

export function declaredOrInitializerType(
  declaration: Node,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): Type | undefined {
  const authored = ast.typeNode(declaration);
  const initializer = Node_Initializer(ast, declaration);
  return semantics.declarations.declaredValueType(declaration) ??
    semantics.declarations.declaredType(declaration) ??
    (authored === undefined ? undefined : semantics.types.authoredType(authored)) ??
    (initializer === undefined ? undefined : semantics.types.expressionType(initializer));
}

export function providerValueReferenceRole(
  node: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  const parent = ast.parent(node);
  if (parent === undefined) return true;
  if ((ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) &&
    Node_Expression(ast, parent) === node) return false;
  if (ast.is.IsPropertyAccessExpression(parent)) return false;
  return true;
}

export function isRuntimeValueOccurrence(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  if (!input.source.ast.is.IsIdentifier(node)) return true;
  const reference = input.source.navigation.sourceReferenceFor(node);
  if (reference === undefined) return true;
  if (!input.indexedSourceUseDeclarations.has(reference.declaration)) {
    input.indexedSourceUseDeclarations.add(reference.declaration);
    for (const use of input.source.navigation.declarationUses(reference.declaration)) {
      input.sourceValueOccurrenceKinds.set(
        use.reference,
        use.kind === "type-only" || use.kind === "source-linkage" ? "non-runtime" : "runtime",
      );
    }
  }
  return input.sourceValueOccurrenceKinds.get(node) === "runtime";
}

export function targetTypeDiagnostic(node: Node, reason: string): TargetDiagnostic {
  return diagnostic(
    "MOJO_TARGET_TYPE_UNSUPPORTED",
    `Selected source type cannot be represented exactly in Mojo: ${reason}.`,
    node,
  );
}

function isCallableBoundary(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) ||
    ast.is.IsArrowFunction(node) ||
    ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) ||
    ast.is.IsSetAccessorDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node);
}
