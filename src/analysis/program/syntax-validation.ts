import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { MojoAnalyzedFunction, MojoCallSelection, MojoPropertySelection } from "./model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";

const supportedBinaryOperators = new Set([
  "KindPlusToken",
  "KindMinusToken",
  "KindAsteriskToken",
  "KindSlashToken",
  "KindPercentToken",
  "KindEqualsEqualsEqualsToken",
  "KindExclamationEqualsEqualsToken",
  "KindLessThanToken",
  "KindLessThanEqualsToken",
  "KindGreaterThanToken",
  "KindGreaterThanEqualsToken",
  "KindAmpersandAmpersandToken",
  "KindBarBarToken",
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindSlashEqualsToken",
]);

const assignmentOperators = new Set([
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindSlashEqualsToken",
]);

export function isMojoAssignmentOperator(operator: string): boolean {
  return assignmentOperators.has(operator);
}

export function validateMojoFunctionSyntax(
  function_: MojoAnalyzedFunction,
  ast: AstReader,
  calls: WeakMap<Node, MojoCallSelection>,
  properties: WeakMap<Node, MojoPropertySelection>,
  bindings: WeakMap<Node, string>,
  diagnostics: TargetDiagnostic[],
): void {
  const validateExpression = (
    expression: Node | undefined,
    assignmentAllowed = false,
  ): void => {
    if (expression === undefined) return;
    if (ast.is.IsIdentifier(expression) || ast.kindName(expression) === "KindThisKeyword") {
      if (bindings.get(expression) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_IDENTIFIER_BINDING_UNRESOLVED",
          `Identifier '${ast.text(expression)}' has no exact project binding or selected provider operation.`,
          expression,
        ));
      }
      return;
    }
    if (ast.is.IsStringLiteral(expression) || ast.is.IsNoSubstitutionTemplateLiteral(expression) ||
      ast.is.IsNumericLiteral(expression) || ast.kindName(expression) === "KindTrueKeyword" ||
      ast.kindName(expression) === "KindFalseKeyword") return;
    if (ast.is.IsParenthesizedExpression(expression)) {
      validateExpression(Node_Expression(ast, expression));
      return;
    }
    if (ast.is.IsBinaryExpression(expression)) {
      const binary = ast.as.AsBinaryExpression(expression);
      const operator = ast.kindName(binary?.OperatorToken);
      if (!supportedBinaryOperators.has(operator)) {
        diagnostics.push(diagnostic(
          "MOJO_BINARY_OPERATOR_UNSUPPORTED",
          `Binary operator '${operator}' has no certified Mojo lowering.`,
          expression,
        ));
      } else if (isMojoAssignmentOperator(operator) && !assignmentAllowed) {
        diagnostics.push(diagnostic(
          "MOJO_ASSIGNMENT_POSITION_UNSUPPORTED",
          "Assignment is supported only as a standalone statement in the current Mojo lowering.",
          expression,
        ));
      }
      validateExpression(binary?.Left);
      validateExpression(binary?.Right);
      return;
    }
    if (ast.is.IsCallExpression(expression) || ast.is.IsNewExpression(expression)) {
      if (calls.get(expression) === undefined) return;
      for (const argument of ast.arguments(expression)) validateExpression(argument);
      return;
    }
    if (ast.is.IsPropertyAccessExpression(expression)) {
      if (properties.get(expression) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_PROPERTY_SELECTION_UNRESOLVED",
          "Property expression has no sealed Mojo operation.",
          expression,
        ));
      }
      validateExpression(Node_Expression(ast, expression));
      return;
    }
    diagnostics.push(diagnostic(
      "MOJO_EXPRESSION_UNSUPPORTED",
      `Expression kind '${ast.kindName(expression)}' has no certified Mojo lowering.`,
      expression,
    ));
  };

  const validateStatement = (statement: Node | undefined): void => {
    if (statement === undefined) return;
    if (ast.is.IsBlock(statement)) {
      for (const child of ast.statements(statement)) validateStatement(child);
      return;
    }
    if (ast.is.IsReturnStatement(statement) || ast.is.IsExpressionStatement(statement)) {
      validateExpression(Node_Expression(ast, statement), ast.is.IsExpressionStatement(statement));
      return;
    }
    if (ast.is.IsVariableStatement(statement)) {
      const list = VariableStatement_DeclarationList(ast, statement);
      for (const declaration of VariableDeclarationList_Declarations(ast, list) ?? []) {
        if (declaration !== undefined && Node_Initializer(ast, declaration) === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_UNINITIALIZED_VARIABLE_UNSUPPORTED",
            "Mojo foundation requires local variables to have an initializer.",
            declaration,
          ));
        }
        validateExpression(Node_Initializer(ast, declaration));
      }
      return;
    }
    if (ast.is.IsIfStatement(statement)) {
      validateExpression(Node_Expression(ast, statement));
      const ifStatement = ast.as.AsIfStatement(statement);
      validateStatement(ifStatement?.ThenStatement);
      validateStatement(ifStatement?.ElseStatement);
      return;
    }
    if (ast.is.IsWhileStatement(statement)) {
      validateExpression(Node_Expression(ast, statement));
      validateStatement(ast.as.AsWhileStatement(statement)?.Statement);
      return;
    }
    diagnostics.push(diagnostic(
      "MOJO_STATEMENT_UNSUPPORTED",
      `Statement kind '${ast.kindName(statement)}' has no certified Mojo lowering.`,
      statement,
    ));
  };
  validateStatement(function_.body);
}
