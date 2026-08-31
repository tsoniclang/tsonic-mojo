import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type {
  MojoAnalyzedFunction,
  MojoCallSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoPropertySelection,
} from "./model.js";
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
  "KindAsteriskAsteriskToken",
  "KindAmpersandToken",
  "KindBarToken",
  "KindCaretToken",
  "KindLessThanLessThanToken",
  "KindGreaterThanGreaterThanToken",
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
  elements: WeakMap<Node, MojoElementSelection>,
  iterations: WeakMap<Node, MojoIterationSelection>,
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
      ast.kindName(expression) === "KindFalseKeyword" || ast.kindName(expression) === "KindNullKeyword" ||
      ast.kindName(expression) === "KindUndefinedKeyword") return;
    if (ast.is.IsArrayLiteralExpression(expression)) {
      for (const element of ast.elements(expression)) {
        if (element === undefined) continue;
        if (ast.is.IsSpreadElement(element)) {
          diagnostics.push(diagnostic(
            "MOJO_ARRAY_SPREAD_UNSUPPORTED",
            "Array spread requires an exact sealed expansion plan.",
            element,
          ));
        } else {
          validateExpression(element);
        }
      }
      return;
    }
    if (ast.is.IsObjectLiteralExpression(expression)) {
      for (const property of ast.properties(expression)) {
        if (property === undefined ||
          (!ast.is.IsPropertyAssignment(property) && !ast.is.IsShorthandPropertyAssignment(property))) {
          diagnostics.push(diagnostic(
            "MOJO_OBJECT_MEMBER_UNSUPPORTED",
            "Object literal member requires a sealed target object-shape operation.",
            property ?? expression,
          ));
          continue;
        }
        validateExpression(Node_Initializer(ast, property) ?? ast.name(property));
      }
      return;
    }
    if (ast.is.IsParenthesizedExpression(expression)) {
      validateExpression(Node_Expression(ast, expression));
      return;
    }
    if (ast.is.IsPrefixUnaryExpression(expression) || ast.is.IsPostfixUnaryExpression(expression)) {
      const operator = ast.operatorKindName(expression);
      const update = operator === "KindPlusPlusToken" || operator === "KindMinusMinusToken";
      if (update && !assignmentAllowed) {
        diagnostics.push(diagnostic(
          "MOJO_UPDATE_POSITION_UNSUPPORTED",
          "Increment and decrement are supported only where their expression result is discarded.",
          expression,
        ));
      } else if (!update && ast.is.IsPostfixUnaryExpression(expression)) {
        diagnostics.push(diagnostic(
          "MOJO_POSTFIX_OPERATOR_UNSUPPORTED",
          `Postfix operator '${operator}' has no certified Mojo lowering.`,
          expression,
        ));
      }
      const operand = ast.is.IsPrefixUnaryExpression(expression)
        ? ast.as.AsPrefixUnaryExpression(expression)?.Operand
        : ast.as.AsPostfixUnaryExpression(expression)?.Operand;
      validateExpression(operand);
      return;
    }
    if (ast.is.IsConditionalExpression(expression)) {
      const conditional = ast.as.AsConditionalExpression(expression);
      validateExpression(conditional?.Condition);
      validateExpression(conditional?.WhenTrue);
      validateExpression(conditional?.WhenFalse);
      return;
    }
    if (ast.is.IsAwaitExpression(expression) || ast.is.IsAsExpression(expression) ||
      ast.is.IsTypeAssertion(expression) || ast.is.IsNonNullExpression(expression) ||
      ast.is.IsSatisfiesExpression(expression)) {
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
    if (ast.is.IsElementAccessExpression(expression)) {
      if (elements.get(expression) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_ELEMENT_SELECTION_UNRESOLVED",
          "Element expression has no sealed Mojo operation.",
          expression,
        ));
      }
      const selected = ast.as.AsElementAccessExpression(expression);
      validateExpression(selected?.Expression);
      validateExpression(selected?.ArgumentExpression);
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
    if (ast.is.IsDoStatement(statement)) {
      validateExpression(Node_Expression(ast, statement));
      validateStatement(ast.as.AsDoStatement(statement)?.Statement);
      return;
    }
    if (ast.is.IsForOfStatement(statement) || ast.is.IsForInStatement(statement)) {
      if (iterations.get(statement) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_ITERATION_SELECTION_UNRESOLVED",
          "Iteration statement has no sealed Mojo iteration operation.",
          statement,
        ));
      }
      validateExpression(Node_Expression(ast, statement));
      validateStatement(ast.as.AsForInOrOfStatement(statement)?.Statement);
      return;
    }
    if (ast.is.IsForStatement(statement)) {
      const initializer = ForStatement_Initializer(ast, statement);
      if (initializer !== undefined) {
        if (ast.is.IsVariableDeclarationList(initializer)) {
          for (const declaration of VariableDeclarationList_Declarations(ast, initializer) ?? []) {
            validateExpression(Node_Initializer(ast, declaration));
          }
        } else {
          validateExpression(initializer, true);
        }
      }
      validateExpression(ForStatement_Condition(ast, statement));
      validateExpression(ForStatement_Incrementor(ast, statement), true);
      validateStatement(ast.as.AsForStatement(statement)?.Statement);
      return;
    }
    if (ast.is.IsBreakStatement(statement) || ast.is.IsContinueStatement(statement)) {
      const label = ast.is.IsBreakStatement(statement)
        ? ast.as.AsBreakStatement(statement)?.Label
        : ast.as.AsContinueStatement(statement)?.Label;
      if (label !== undefined) {
        diagnostics.push(diagnostic(
          "MOJO_LABELED_COMPLETION_UNSUPPORTED",
          "Labeled break and continue require a sealed target completion-flow plan.",
          statement,
        ));
      }
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
