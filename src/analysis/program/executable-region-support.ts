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
import {
  mergeMojoErrorTypes,
  mojoConversionRaises,
  mojoNativeErrorType,
  mojoOperationErrorTypes,
  providerCallRequiresRaisingConversion,
} from "./effects.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";

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
    navigation: input.source.navigation,
    semantics,
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
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
    if ((property?.kind === "provider" || property?.kind === "project-field" ||
      property?.kind === "structural-field" ||
      property?.kind === "project-index-property") &&
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
    "MOJO_LOCAL_BINDING_CARRIER_UNRESOLVED",
    `Selected local binding type cannot be represented exactly in Mojo: ${reason}.`,
    node,
  );
}

export function executableRegionErrorTypes(
  root: Node,
  input: MojoExecutableRegionAnalysisInput,
): readonly MojoTargetTypeRef[] {
  const errors: MojoTargetTypeRef[] = [];
  const addNativeConversionError = (raises: boolean): void => {
    if (raises) errors.push(mojoNativeErrorType());
  };
  walkSourceTree(root, input.source.ast, (node): void => {
    if (input.source.ast.is.IsRegularExpressionLiteral(node)) {
      const type = input.expressionTypes.get(node);
      if (type?.kind === "target-named" && type.id === "tsonic.mojo.js.JsRegExp") {
        errors.push(mojoNativeErrorType());
      }
    }
    if (input.source.ast.is.IsCallExpression(node) || input.source.ast.is.IsNewExpression(node)) {
      const selection = input.callSelections.get(node);
      if (selection?.kind === "provider") {
        errors.push(...mojoOperationErrorTypes(selection.operation));
        addNativeConversionError(providerCallRequiresRaisingConversion(selection));
      } else if (selection?.kind === "project" || selection?.kind === "callable") {
        addNativeConversionError(selection.arguments.some((argument) =>
          mojoConversionRaises(argument.conversion)) ||
          mojoConversionRaises(selection.resultConversion) ||
          (selection.kind === "callable" && selection.callableType.raises));
      }
    }
    if (input.source.ast.is.IsThrowStatement(node)) {
      const expression = Node_Expression(input.source.ast, node);
      const type = expression === undefined ? undefined : input.expressionTypes.get(expression);
      if (type === undefined) {
        input.diagnostics.push(diagnostic(
          "MOJO_THROW_ERROR_CARRIER_NOT_CLOSED",
          "A throw statement requires one exact sealed Mojo error carrier.",
          node,
        ));
      } else {
        errors.push(type);
      }
    }
    if (input.source.ast.is.IsPropertyAccessExpression(node)) {
      const selection = input.propertySelections.get(node);
      if (selection?.kind === "provider") {
        if (selection.readOperation !== undefined) {
          errors.push(...mojoOperationErrorTypes(selection.readOperation));
        }
        if (selection.writeOperation !== undefined) {
          errors.push(...mojoOperationErrorTypes(selection.writeOperation));
        }
        addNativeConversionError(
          (selection.receiverConversion !== undefined && mojoConversionRaises(selection.receiverConversion)) ||
          (selection.readResultConversion !== undefined && mojoConversionRaises(selection.readResultConversion)),
        );
      } else if (selection?.kind === "provider-constant") {
        errors.push(...mojoOperationErrorTypes(selection.operation));
        addNativeConversionError(mojoConversionRaises(selection.readResultConversion));
      } else if (selection?.kind === "provider-static") {
        if (selection.readOperation !== undefined) {
          errors.push(...mojoOperationErrorTypes(selection.readOperation));
        }
        if (selection.writeOperation !== undefined) {
          errors.push(...mojoOperationErrorTypes(selection.writeOperation));
        }
        addNativeConversionError(
          selection.readResultConversion !== undefined && mojoConversionRaises(selection.readResultConversion),
        );
      }
    }
    if (input.source.ast.is.IsIdentifier(node)) {
      const selection = input.valueSelections.get(node);
      if (selection !== undefined) {
        errors.push(...mojoOperationErrorTypes(selection.operation));
        addNativeConversionError(mojoConversionRaises(selection.resultConversion));
      }
    }
    if (input.source.ast.is.IsElementAccessExpression(node)) {
      const selection = input.elementSelections.get(node);
      if (selection !== undefined) {
        addNativeConversionError(mojoConversionRaises(selection.indexConversion) ||
          (selection.readResultConversion !== undefined &&
            mojoConversionRaises(selection.readResultConversion)));
        if (selection.kind === "provider") {
          if (selection.readOperation !== undefined) {
            errors.push(...mojoOperationErrorTypes(selection.readOperation));
          }
          if (selection.writeOperation !== undefined) {
            errors.push(...mojoOperationErrorTypes(selection.writeOperation));
          }
          addNativeConversionError(mojoConversionRaises(selection.receiverConversion));
        }
      }
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, input.source.ast));
  return mergeMojoErrorTypes(errors);
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
