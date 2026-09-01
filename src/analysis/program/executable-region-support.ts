import type { Node, Type } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { analyzeMojoProviderValue } from "../operations/values.js";
import type { MojoExecutableRegionAnalysisInput } from "./executable-regions.js";
import type { MojoCallSelection, MojoPropertySelection } from "./model.js";
import { providerCallRequiresRaisingConversion } from "./effects.js";
import { walkSourceTree } from "./traversal.js";

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
  calls: WeakMap<Node, MojoCallSelection>,
  properties: WeakMap<Node, MojoPropertySelection>,
): boolean {
  const parent = ast.parent(node);
  if (parent === undefined) return true;
  if ((ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) &&
    Node_Expression(ast, parent) === node) return false;
  if (ast.is.IsPropertyAccessExpression(parent)) {
    const property = properties.get(parent);
    if ((property?.kind === "provider" || property?.kind === "project-field") &&
      property.receiver === node) return true;
    const callNode = ast.parent(parent);
    if ((callNode === undefined || (!ast.is.IsCallExpression(callNode) && !ast.is.IsNewExpression(callNode))) ||
      Node_Expression(ast, callNode) !== parent) return false;
    const call = calls.get(callNode);
    if (call?.kind === "provider") return call.receiver === node;
    return call?.kind === "project" && call.target.kind === "method" &&
      call.target.receiver === node;
  }
  return true;
}

export function analyzeExecutableRegionProviderValues(
  root: Node,
  input: MojoExecutableRegionAnalysisInput,
): void {
  const ast = input.source.ast;
  walkSourceTree(root, ast, (node): void => {
    if (!ast.is.IsIdentifier(node) || !isRuntimeValueOccurrence(node, input) ||
      input.bindingNames.get(node) !== undefined || input.valueSelections.get(node) !== undefined ||
      !providerValueReferenceRole(node, ast, input.callSelections, input.propertySelections)) return;
    const selectedType = input.expressionTypes.get(node);
    if (selectedType === undefined) return;
    const value = analyzeMojoProviderValue(
      node,
      selectedType,
      input.source,
      input.providerSemantics,
      input.conversions,
    );
    if (value.kind === "unsupported") {
      input.diagnostics.push(diagnostic(value.code, value.reason, node));
    } else if (value.kind === "resolved") {
      input.valueSelections.set(node, value.selection);
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, ast));
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

export function executableRegionRaises(
  root: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  let raises = false;
  walkSourceTree(root, input.source.ast, (node): void => {
    if (input.source.ast.is.IsCallExpression(node) || input.source.ast.is.IsNewExpression(node)) {
      const selection = input.callSelections.get(node);
      if (selection?.kind === "provider") {
        raises = raises || selection.operation.raises || providerCallRequiresRaisingConversion(selection);
      }
    }
    if (input.source.ast.is.IsThrowStatement(node)) raises = true;
    if (input.source.ast.is.IsPropertyAccessExpression(node)) {
      const selection = input.propertySelections.get(node);
      if (selection?.kind === "provider") {
        raises = raises || selection.readOperation?.raises === true ||
          selection.writeOperation?.raises === true ||
          selection.receiverConversion?.kind === "js-to-native-string" ||
          selection.readResultConversion?.kind === "js-to-native-string";
      } else if (selection?.kind === "provider-constant") {
        raises = raises || selection.operation.raises ||
          selection.readResultConversion.kind === "js-to-native-string";
      }
    }
    if (input.source.ast.is.IsIdentifier(node)) {
      const selection = input.valueSelections.get(node);
      raises = raises || selection?.operation.raises === true ||
        selection?.resultConversion.kind === "js-to-native-string";
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, input.source.ast));
  return raises;
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
