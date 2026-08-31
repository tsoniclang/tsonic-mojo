import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type { MojoAnalyzedFunction } from "../program/model.js";
import type { MojoConversionIndex } from "./classification.js";

export function recordMojoFunctionConversionUses(
  function_: MojoAnalyzedFunction,
  ast: AstReader,
  bindingTypes: WeakMap<Node, MojoTargetTypeRef>,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  conversions: MojoConversionIndex,
  diagnostics: TargetDiagnostic[],
): void {
  const record = (expression: Node | undefined, expected: MojoTargetTypeRef): void => {
    if (expression === undefined) return;
    const actual = expressionTypes.get(expression);
    if (actual === undefined) {
      diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_EXPRESSION_CARRIER_NOT_CLOSED",
        `Expression '${ast.kindName(expression)}' has no sealed Mojo carrier.`,
        expression,
      ));
      return;
    }
    const result = conversions.record(expression, actual, expected);
    if (result.kind === "unsupported") {
      diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_VALUE_CONVERSION_UNPROVEN",
        result.reason,
        expression,
      ));
    }
  };
  const visitExpression = (expression: Node | undefined): void => {
    if (expression === undefined) return;
    if (ast.is.IsParenthesizedExpression(expression)) {
      const inner = Node_Expression(ast, expression);
      const expected = expressionTypes.get(expression);
      if (expected !== undefined) record(inner, expected);
      visitExpression(inner);
      return;
    }
    if (ast.is.IsBinaryExpression(expression)) {
      const left = BinaryExpression_Left(ast, expression);
      const right = BinaryExpression_Right(ast, expression);
      const operator = ast.operatorKindName(expression);
      const resultType = expressionTypes.get(expression);
      if (operator === "KindAmpersandAmpersandToken" || operator === "KindBarBarToken") {
        const bool: MojoTargetTypeRef = { kind: "source-primitive", name: "bool" };
        record(left, bool);
        record(right, bool);
      } else if (operator?.endsWith("EqualsToken") === true && operator !== "KindEqualsEqualsToken" &&
        operator !== "KindEqualsEqualsEqualsToken" && operator !== "KindExclamationEqualsToken" &&
        operator !== "KindExclamationEqualsEqualsToken") {
        const leftType = left === undefined ? undefined : expressionTypes.get(left);
        if (leftType !== undefined) record(right, leftType);
      } else if (resultType !== undefined && !isComparison(operator)) {
        record(left, resultType);
        record(right, resultType);
      } else {
        const leftType = left === undefined ? undefined : expressionTypes.get(left);
        const rightType = right === undefined ? undefined : expressionTypes.get(right);
        if (leftType !== undefined && rightType !== undefined) {
          if (ast.is.IsNumericLiteral(left!)) record(left, rightType);
          else record(right, leftType);
        }
      }
      visitExpression(left);
      visitExpression(right);
      return;
    }
    for (const child of ast.children(expression)) {
      if (child !== undefined) visitExpression(child);
    }
  };
  const visitStatement = (statement: Node | undefined): void => {
    if (statement === undefined) return;
    if (ast.is.IsBlock(statement)) {
      for (const child of ast.statements(statement)) visitStatement(child);
      return;
    }
    if (ast.is.IsReturnStatement(statement)) {
      const expression = Node_Expression(ast, statement);
      record(expression, function_.resultType);
      visitExpression(expression);
      return;
    }
    if (ast.is.IsVariableStatement(statement)) {
      const declarations = VariableDeclarationList_Declarations(
        ast,
        VariableStatement_DeclarationList(ast, statement),
      ) ?? [];
      for (const declaration of declarations) {
        if (declaration === undefined) continue;
        const initializer = Node_Initializer(ast, declaration);
        const expected = bindingTypes.get(declaration);
        if (expected !== undefined) record(initializer, expected);
        visitExpression(initializer);
      }
      return;
    }
    if (ast.is.IsIfStatement(statement) || ast.is.IsWhileStatement(statement) || ast.is.IsDoStatement(statement)) {
      const condition = Node_Expression(ast, statement);
      record(condition, { kind: "source-primitive", name: "bool" });
    }
    for (const child of ast.children(statement)) {
      if (child === undefined) continue;
      if (isStatement(child, ast)) visitStatement(child);
      else visitExpression(child);
    }
  };
  visitStatement(function_.body);
}

function isComparison(operator: string | undefined): boolean {
  return operator === "KindEqualsEqualsToken" || operator === "KindEqualsEqualsEqualsToken" ||
    operator === "KindExclamationEqualsToken" || operator === "KindExclamationEqualsEqualsToken" ||
    operator === "KindLessThanToken" || operator === "KindLessThanEqualsToken" ||
    operator === "KindGreaterThanToken" || operator === "KindGreaterThanEqualsToken";
}

function isStatement(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind.endsWith("Statement") || kind === "KindBlock";
}
