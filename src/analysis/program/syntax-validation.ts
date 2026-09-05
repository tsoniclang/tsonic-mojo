import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  CatchClause_Block,
  Node_Expression,
  Node_Initializer,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type {
  MojoArrayLiteralSelection,
  MojoBindingPatternSelection,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoIntrinsicExpressionSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTemplateExpressionSelection,
  MojoTypeTestSelection,
  MojoValueSelection,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
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
  "KindQuestionQuestionToken",
  "KindAsteriskAsteriskToken",
  "KindAmpersandToken",
  "KindBarToken",
  "KindCaretToken",
  "KindLessThanLessThanToken",
  "KindGreaterThanGreaterThanToken",
  "KindGreaterThanGreaterThanGreaterThanToken",
  "KindAmpersandEqualsToken",
  "KindBarEqualsToken",
  "KindCaretEqualsToken",
  "KindLessThanLessThanEqualsToken",
  "KindGreaterThanGreaterThanEqualsToken",
  "KindGreaterThanGreaterThanGreaterThanEqualsToken",
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindSlashEqualsToken",
]);

const assignmentOperators = new Set([
  "KindAmpersandEqualsToken",
  "KindBarEqualsToken",
  "KindCaretEqualsToken",
  "KindLessThanLessThanEqualsToken",
  "KindGreaterThanGreaterThanEqualsToken",
  "KindGreaterThanGreaterThanGreaterThanEqualsToken",
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindSlashEqualsToken",
]);

export function isMojoAssignmentOperator(operator: string): boolean {
  return assignmentOperators.has(operator);
}

export function validateMojoExecutableRegionSyntax(
  root: Node,
  rootKind: "expression" | "statement" | "declaration",
  ast: AstReader,
  calls: WeakMap<Node, MojoCallSelection>,
  properties: WeakMap<Node, MojoPropertySelection>,
  elements: WeakMap<Node, MojoElementSelection>,
  iterations: WeakMap<Node, MojoIterationSelection>,
  values: WeakMap<Node, MojoValueSelection>,
  intrinsicExpressions: WeakMap<Node, MojoIntrinsicExpressionSelection>,
  typeTests: WeakMap<Node, MojoTypeTestSelection>,
  arrayLiterals: WeakMap<Node, MojoArrayLiteralSelection>,
  objectLiterals: WeakMap<Node, MojoObjectLiteralSelection>,
  callableExpressions: WeakMap<Node, MojoCallableExpressionSelection>,
  bindingPatterns: WeakMap<Node, MojoBindingPatternSelection>,
  resources: WeakMap<Node, MojoResourceManagementSelection>,
  bindings: WeakMap<Node, string>,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  templateExpressions: WeakMap<Node, MojoTemplateExpressionSelection>,
  diagnostics: TargetDiagnostic[],
): void {
  const validateResourceDeclaration = (declaration: Node): void => {
    const kind = ast.variableDeclarationKind(declaration);
    if (kind !== "using" && kind !== "await using") return;
    if (resources.get(declaration) === undefined) {
      diagnostics.push(diagnostic(
        "MOJO_RESOURCE_MANAGEMENT_SELECTION_UNRESOLVED",
        `TypeScript '${kind}' has no sealed Mojo acquisition and disposal selection.`,
        declaration,
      ));
    }
  };
  const validateResourceDeclarations = (list: Node | undefined): void => {
    for (const declaration of VariableDeclarationList_Declarations(ast, list) ?? []) {
      if (declaration !== undefined) validateResourceDeclaration(declaration);
    }
  };
  const validateExpression = (expression: Node | undefined): void => {
    if (expression === undefined) return;
    const expressionType = expressionTypes.get(expression);
    if (expressionType?.kind === "null" || expressionType?.kind === "undefined") return;
    if (ast.is.IsIdentifier(expression) || ast.kindName(expression) === "KindThisKeyword") {
      if (bindings.get(expression) === undefined && values.get(expression) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_IDENTIFIER_BINDING_UNRESOLVED",
          `Identifier '${ast.text(expression)}' has no exact project binding or selected provider operation.`,
          expression,
        ));
      }
      return;
    }
    if (ast.is.IsStringLiteral(expression) || ast.is.IsNoSubstitutionTemplateLiteral(expression) ||
      ast.is.IsNumericLiteral(expression) || ast.is.IsBigIntLiteral(expression) ||
      ast.kindName(expression) === "KindTrueKeyword" ||
      ast.kindName(expression) === "KindFalseKeyword" || ast.kindName(expression) === "KindNullKeyword" ||
      ast.kindName(expression) === "KindUndefinedKeyword") return;
    if (ast.kindName(expression) === "KindTemplateExpression") {
      if (templateExpressions.get(expression) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_TEMPLATE_SELECTION_UNRESOLVED",
          "Template expression has no sealed source-string conversion selection.",
          expression,
        ));
      }
      for (const span of TemplateExpression_TemplateSpans(ast, expression) ?? []) {
        if (span !== undefined) validateExpression(TemplateSpan_Expression(ast, span));
      }
      return;
    }
    if (ast.is.IsArrayLiteralExpression(expression)) {
      const selection = arrayLiterals.get(expression);
      if (selection === undefined && !diagnostics.some((entry) => entry.sourceNode === expression)) {
        diagnostics.push(diagnostic(
          "MOJO_ARRAY_LITERAL_SELECTION_UNRESOLVED",
          "An array literal has no exact sealed aggregate plan.",
          expression,
        ));
      }
      for (const contribution of selection?.contributions ?? []) {
        validateExpression(contribution.expression);
      }
      return;
    }
    if (ast.is.IsObjectLiteralExpression(expression)) {
      const selected = objectLiterals.get(expression);
      if (selected !== undefined) {
        if (selected.kind === "interface") {
          for (const contribution of selected.contributions) {
            if (contribution.kind === "index-entry" && contribution.key.kind === "expression") {
              validateExpression(contribution.key.expression);
            }
            if (contribution.kind === "field" || contribution.kind === "index-entry" ||
              contribution.kind === "spread") {
              validateExpression(contribution.value);
              continue;
            }
            const callable = callableExpressions.get(contribution.element);
            if (callable === undefined) {
              diagnostics.push(diagnostic(
                "MOJO_OBJECT_CALLABLE_SELECTION_UNRESOLVED",
                "Object-literal callable member has no sealed Mojo implementation selection.",
                contribution.element,
              ));
              continue;
            }
            for (const parameter of callable.parameters) validateExpression(parameter.initializer);
            if (ast.is.IsBlock(callable.body)) validateStatement(callable.body);
            else validateExpression(callable.body);
          }
        } else {
          for (const field of selected.fields) validateExpression(field.value);
        }
        return;
      }
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
    if (ast.is.IsDeleteExpression(expression)) {
      const operand = Node_Expression(ast, expression);
      const selection = operand === undefined ? undefined : elements.get(operand);
      if (selection?.kind !== "js-array-delete" &&
        !diagnostics.some((entry) => entry.sourceNode === operand)) {
        diagnostics.push(diagnostic(
          "MOJO_DELETE_SELECTION_UNRESOLVED",
          "delete requires one exact sealed JavaScript Array mutation.",
          expression,
        ));
      }
      validateExpression(operand);
      return;
    }
    if (ast.is.IsRegularExpressionLiteral(expression)) {
      const expressionType = expressionTypes.get(expression);
      if (expressionType?.kind !== "target-named" ||
        expressionType.id !== "tsonic.mojo.js.JsRegExp") {
        diagnostics.push(diagnostic(
          "MOJO_REGEXP_LITERAL_CARRIER_UNRESOLVED",
          "A regular-expression literal has no exact sealed JavaScript RegExp carrier.",
          expression,
        ));
      }
      return;
    }
    if (ast.is.IsTypeOfExpression(expression) || ast.is.IsVoidExpression(expression)) {
      if (intrinsicExpressions.get(expression) === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_INTRINSIC_EXPRESSION_SELECTION_UNRESOLVED",
          `${ast.is.IsTypeOfExpression(expression) ? "typeof" : "void"} has no exact sealed Mojo operation.`,
          expression,
        ));
      }
      validateExpression(Node_Expression(ast, expression));
      return;
    }
    if (ast.is.IsPrefixUnaryExpression(expression) || ast.is.IsPostfixUnaryExpression(expression)) {
      const operator = ast.operatorKindName(expression);
      const update = operator === "KindPlusPlusToken" || operator === "KindMinusMinusToken";
      if (!update && ast.is.IsPostfixUnaryExpression(expression)) {
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
    if (ast.is.IsArrowFunction(expression) || ast.is.IsFunctionExpression(expression)) {
      const selection = callableExpressions.get(expression);
      if (selection === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_CALLABLE_EXPRESSION_SELECTION_UNRESOLVED",
          "Callable expression has no sealed Mojo lambda selection.",
          expression,
        ));
        return;
      }
      for (const parameter of selection.parameters) validateExpression(parameter.initializer);
      if (ast.is.IsBlock(selection.body)) validateStatement(selection.body);
      else validateExpression(selection.body);
      return;
    }
    if (ast.is.IsBinaryExpression(expression)) {
      const binary = ast.as.AsBinaryExpression(expression);
      const operator = ast.kindName(binary?.OperatorToken);
      if (operator === "KindInstanceOfKeyword") {
        if (typeTests.get(expression) === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_INSTANCEOF_SELECTION_UNRESOLVED",
            "Checked instanceof requires one exact sealed Mojo project type-test selection.",
            expression,
          ));
        }
        validateExpression(binary?.Left);
        return;
      }
      const left = BinaryExpression_Left(ast, expression);
      const right = BinaryExpression_Right(ast, expression);
      const looseIdentity = (operator === "KindEqualsEqualsToken" ||
          operator === "KindExclamationEqualsToken") &&
        left !== undefined && right !== undefined &&
        expressionTypes.get(left)?.kind === "callable" &&
        expressionTypes.get(right)?.kind === "callable";
      if (!supportedBinaryOperators.has(operator) &&
        typeTests.get(expression) === undefined && !looseIdentity) {
        diagnostics.push(diagnostic(
          "MOJO_BINARY_OPERATOR_UNSUPPORTED",
          `Binary operator '${operator}' has no certified Mojo lowering.`,
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
      const selection = properties.get(expression);
      if (selection === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_PROPERTY_SELECTION_UNRESOLVED",
          "Property expression has no sealed Mojo operation.",
          expression,
        ));
      }
      if (selection?.kind !== "provider-constant" &&
        selection?.kind !== "project-enum-member" &&
        selection?.kind !== "project-static-field" &&
        selection?.kind !== "provider-static") {
        validateExpression(Node_Expression(ast, expression));
      }
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
    if (ast.is.IsEmptyStatement(statement)) return;
    if (ast.is.IsDebuggerStatement(statement)) return;
    if (ast.is.IsBlock(statement)) {
      for (const child of ast.statements(statement)) validateStatement(child);
      return;
    }
    if (ast.is.IsReturnStatement(statement) || ast.is.IsExpressionStatement(statement)) {
      validateExpression(Node_Expression(ast, statement));
      return;
    }
    if (ast.is.IsThrowStatement(statement)) {
      validateExpression(Node_Expression(ast, statement));
      return;
    }
    if (ast.is.IsVariableStatement(statement)) {
      const list = VariableStatement_DeclarationList(ast, statement);
      validateResourceDeclarations(list);
      for (const declaration of VariableDeclarationList_Declarations(ast, list) ?? []) {
        if (declaration === undefined) continue;
        const name = ast.name(declaration);
        if (name !== undefined &&
          (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name)) &&
          bindingPatterns.get(declaration) === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_BINDING_PATTERN_SELECTION_UNRESOLVED",
            "Binding pattern has no sealed Mojo aggregate projection.",
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
      const initializer = ast.as.AsForInOrOfStatement(statement)?.Initializer;
      if (initializer !== undefined && ast.is.IsVariableDeclarationList(initializer)) {
        validateResourceDeclarations(initializer);
      }
      if (iterations.get(statement) === undefined &&
        !diagnostics.some((entry) => entry.sourceNode === statement)) {
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
          validateResourceDeclarations(initializer);
          for (const declaration of VariableDeclarationList_Declarations(ast, initializer) ?? []) {
            validateExpression(Node_Initializer(ast, declaration));
          }
        } else {
          validateExpression(initializer);
        }
      }
      validateExpression(ForStatement_Condition(ast, statement));
      validateExpression(ForStatement_Incrementor(ast, statement));
      validateStatement(ast.as.AsForStatement(statement)?.Statement);
      return;
    }
    if (ast.is.IsSwitchStatement(statement)) {
      validateExpression(SwitchStatement_Expression(ast, statement));
      for (const clause of CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, statement)) ?? []) {
        validateExpression(CaseOrDefaultClause_Expression(ast, clause));
        for (const child of CaseOrDefaultClause_Statements(ast, clause) ?? []) {
          validateStatement(child);
        }
      }
      return;
    }
    if (ast.is.IsTryStatement(statement)) {
      validateStatement(TryStatement_TryBlock(ast, statement));
      validateStatement(CatchClause_Block(ast, TryStatement_CatchClause(ast, statement)));
      validateStatement(TryStatement_FinallyBlock(ast, statement));
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
  if (rootKind === "expression") {
    validateExpression(root);
  } else if (rootKind === "declaration") {
    validateResourceDeclaration(root);
    validateExpression(Node_Initializer(ast, root));
  } else {
    validateStatement(root);
  }
}
