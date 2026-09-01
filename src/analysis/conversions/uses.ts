import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  Node_Expression,
  Node_Initializer,
  ObjectLiteralProperty_Value,
  PrefixUnaryExpression_Operand,
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedFunction,
  MojoElementSelection,
  MojoPropertySelection,
} from "../program/model.js";
import type { MojoConversionIndex } from "./classification.js";

export function recordMojoFunctionConversionUses(
  function_: MojoAnalyzedFunction,
  ast: AstReader,
  bindingTypes: WeakMap<Node, MojoTargetTypeRef>,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  propertySelections: WeakMap<Node, MojoPropertySelection>,
  elementSelections: WeakMap<Node, MojoElementSelection>,
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
    if (ast.is.IsArrayLiteralExpression(expression)) {
      const type = expressionTypes.get(expression);
      const elements = ast.elements(expression);
      const expected = type?.kind === "list" || type?.kind === "fixed-array"
        ? elements.map(() => type.element)
        : type?.kind === "tuple"
          ? type.elements
          : type?.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray"
            ? elements.map(() => type.genericArguments?.[0]?.kind === "type"
                ? type.genericArguments[0].type
                : undefined)
            : [];
      for (const [index, element] of elements.entries()) {
        const target = expected[index];
        if (element !== undefined && target !== undefined && !ast.is.IsSpreadElement(element)) record(element, target);
        visitExpression(element);
      }
      return;
    }
    if (ast.is.IsObjectLiteralExpression(expression)) {
      const type = expressionTypes.get(expression);
      for (const property of ast.properties(expression)) {
        const value = ObjectLiteralProperty_Value(ast, property);
        if (type?.kind === "dictionary") record(value, type.value);
        visitExpression(value);
      }
      return;
    }
    if (ast.is.IsConditionalExpression(expression)) {
      const condition = ConditionalExpression_Condition(ast, expression);
      const whenTrue = ConditionalExpression_WhenTrue(ast, expression);
      const whenFalse = ConditionalExpression_WhenFalse(ast, expression);
      const result = expressionTypes.get(expression);
      record(condition, { kind: "source-primitive", name: "bool" });
      if (result !== undefined) {
        record(whenTrue, result);
        record(whenFalse, result);
      }
      visitExpression(condition);
      visitExpression(whenTrue);
      visitExpression(whenFalse);
      return;
    }
    if (ast.is.IsPrefixUnaryExpression(expression)) {
      const operand = PrefixUnaryExpression_Operand(ast, expression);
      const expected = ast.operatorKindName(expression) === "KindExclamationToken"
        ? { kind: "source-primitive" as const, name: "bool" as const }
        : expressionTypes.get(expression);
      if (expected !== undefined) record(operand, expected);
      visitExpression(operand);
      return;
    }
    if (ast.is.IsAsExpression(expression) || ast.is.IsTypeAssertion(expression) ||
      ast.is.IsNonNullExpression(expression) || ast.is.IsSatisfiesExpression(expression)) {
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
      if (operator === "KindQuestionQuestionToken") {
        if (resultType !== undefined) record(right, resultType);
      } else if (operator === "KindAmpersandAmpersandToken" || operator === "KindBarBarToken") {
        const bool: MojoTargetTypeRef = { kind: "source-primitive", name: "bool" };
        record(left, bool);
        record(right, bool);
      } else if (operator?.endsWith("EqualsToken") === true && operator !== "KindEqualsEqualsToken" &&
        operator !== "KindEqualsEqualsEqualsToken" && operator !== "KindExclamationEqualsToken" &&
        operator !== "KindExclamationEqualsEqualsToken") {
        const property = left === undefined ? undefined : propertySelections.get(left);
        const element = left === undefined ? undefined : elementSelections.get(left);
        const leftType = property?.kind === "provider"
          ? property.writeOperation?.parameterTypes[0]
          : element?.writeType ??
            (left === undefined ? undefined : expressionTypes.get(left));
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
    if (ast.is.IsSwitchStatement(statement)) {
      const discriminant = SwitchStatement_Expression(ast, statement);
      const discriminantType = discriminant === undefined ? undefined : expressionTypes.get(discriminant);
      visitExpression(discriminant);
      for (const clause of CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, statement)) ?? []) {
        const expression = CaseOrDefaultClause_Expression(ast, clause);
        if (discriminantType !== undefined) record(expression, discriminantType);
        visitExpression(expression);
      }
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
