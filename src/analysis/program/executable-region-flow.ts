import { argumentPassingFactKey } from "@tsonic/tsts";
import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  TryStatement_FinallyBlock,
} from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoParameterAbi } from "../../policy/callables/parameter-abi.js";
import { analyzeMojoNullishCoalescing } from "../operations/nullish-coalescing.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import type { MojoBindingPatternSelection } from "./model.js";
import type { MojoExecutableRegionAnalysisInput } from "./executable-regions.js";

export function analyzeNullishCoalescing(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): void {
  const left = BinaryExpression_Left(input.source.ast, node);
  const right = BinaryExpression_Right(input.source.ast, node);
  const leftType = left === undefined ? undefined : input.expressionTypes.get(left);
  const rightType = right === undefined ? undefined : input.expressionTypes.get(right);
  if (left === undefined || right === undefined || leftType === undefined || rightType === undefined) {
    input.diagnostics.push(diagnostic(
      "MOJO_NULLISH_COALESCING_OPERAND_NOT_CLOSED",
      "Nullish coalescing requires exact sealed left and fallback carriers.",
      node,
    ));
    return;
  }
  const result = analyzeMojoNullishCoalescing(
    left,
    right,
    leftType,
    rightType,
    input.expressionTypes.get(node),
    input.source.ast,
  );
  if (result.kind === "unsupported") {
    input.diagnostics.push(diagnostic(
      "MOJO_NULLISH_COALESCING_CONTRACT_UNCLOSED",
      result.reason,
      node,
    ));
    return;
  }
  input.nullishCoalescingSelections.set(node, result.selection);
  input.expressionTypes.set(node, result.expressionType);
}

export function selectReturnValueTransfer(
  expression: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  const { ast } = input.source;
  const expressionType = input.expressionTypes.get(expression);
  if (!ast.is.IsIdentifier(expression) || input.returnType === undefined ||
    expressionType === undefined || input.valueRefinements.has(expression) ||
    !mojoTargetTypeEquals(expressionType, input.returnType)) {
    return false;
  }
  const reference = input.source.navigation.sourceReferenceFor(expression);
  const declaration = reference?.project === true ? reference.declaration : undefined;
  if (declaration === undefined || input.locationStorageNames.has(declaration) ||
    input.resourceDeclarations.has(declaration) || returnFinallyUsesDeclaration(expression, declaration, input)) {
    return false;
  }
  if (ast.is.IsParameterDeclaration(declaration)) {
    const mode = input.source.sourceFacts.getFact(declaration, argumentPassingFactKey)?.mode;
    return mojoParameterAbi(mode).convention === "var";
  }
  if (ast.is.IsBindingElement(declaration)) {
    return sourceNodeIsWithin(declaration, input.root, ast) &&
      !isIterationBindingDeclaration(declaration, ast);
  }
  return ast.is.IsVariableDeclaration(declaration) &&
    sourceNodeIsWithin(declaration, input.root, ast) &&
    !isIterationBindingDeclaration(declaration, ast);
}

function returnFinallyUsesDeclaration(
  expression: Node,
  declaration: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  const { ast } = input.source;
  const uses = input.source.navigation.declarationUses(declaration);
  let current: Node | undefined = expression;
  while (current !== undefined && current !== input.root) {
    const parent = ast.parent(current);
    if (parent === undefined) break;
    if (ast.is.IsTryStatement(parent)) {
      const finallyBlock = TryStatement_FinallyBlock(ast, parent);
      if (finallyBlock !== undefined && !sourceNodeIsWithin(current, finallyBlock, ast) &&
        uses.some(({ reference }) => sourceNodeIsWithin(reference, finallyBlock, ast))) {
        return true;
      }
    }
    current = parent;
  }
  return false;
}

function isIterationBindingDeclaration(declaration: Node, ast: AstReader): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    const parent = ast.parent(current);
    if (parent === undefined) return false;
    if (ast.is.IsForOfStatement(parent) || ast.is.IsForInStatement(parent)) return true;
    if (!ast.is.IsVariableDeclarationList(parent) && !ast.is.IsBindingElement(parent) &&
      !ast.is.IsArrayBindingPattern(parent) && !ast.is.IsObjectBindingPattern(parent)) return false;
    current = parent;
  }
  return false;
}

function sourceNodeIsWithin(node: Node, root: Node, ast: AstReader): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === root) return true;
    current = ast.parent(current);
  }
  return false;
}

export function publishBindingPatternCarriers(
  elements: readonly MojoBindingPatternSelection["elements"][number][],
  input: MojoExecutableRegionAnalysisInput,
): void {
  for (const element of elements) {
    if (element.target.kind === "pattern") {
      publishBindingPatternCarriers(element.target.elements, input);
      continue;
    }
    for (const use of input.source.navigation.declarationUses(element.target.declaration)) {
      if (use.kind !== "type-only" && use.kind !== "source-linkage") {
        input.expressionTypes.set(use.reference, element.target.type);
      }
    }
  }
}
