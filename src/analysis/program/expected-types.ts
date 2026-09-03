import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
  PrefixUnaryExpression_Operand,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoCallSelection } from "./model.js";
import type { MojoExecutableRegionAnalysisInput } from "./executable-regions.js";
import { isMojoAssignmentOperator } from "./syntax-validation.js";

export function expectedExpressionType(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): MojoTargetTypeRef | undefined {
  const { ast } = input.source;
  if (node === input.root && input.rootExpectedType !== undefined) return input.rootExpectedType;
  const parent = ast.parent(node);
  if (parent === undefined) return undefined;
  if (ast.is.IsVariableDeclaration(parent) && Node_Initializer(ast, parent) === node) {
    return input.bindingTypes.get(parent);
  }
  if (ast.is.IsReturnStatement(parent) && Node_Expression(ast, parent) === node) {
    return input.returnType;
  }
  if (ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) {
    return callArgumentExpectedType(input.callSelections.get(parent), node);
  }
  if (ast.is.IsArrayLiteralExpression(parent)) {
    const index = ast.elements(parent).findIndex((element) => element === node);
    const aggregate = input.expressionTypes.get(parent);
    if (index < 0 || aggregate === undefined) return undefined;
    if (aggregate.kind === "list" || aggregate.kind === "fixed-array") return aggregate.element;
    if (aggregate.kind === "tuple") return aggregate.elements[index];
    if (aggregate.kind === "target-named" && aggregate.id === "tsonic.mojo.js.JsArray") {
      const argument = aggregate.genericArguments?.[0];
      return argument?.kind === "type" ? argument.type : undefined;
    }
  }
  if (ast.is.IsPrefixUnaryExpression(parent) && PrefixUnaryExpression_Operand(ast, parent) === node) {
    return ast.operatorKindName(parent) === "KindExclamationToken"
      ? Object.freeze({ kind: "source-primitive", name: "bool" })
      : input.expressionTypes.get(parent);
  }
  if (ast.is.IsPropertyAssignment(parent) || ast.is.IsShorthandPropertyAssignment(parent)) {
    const owner = ast.parent(parent);
    const selection = owner === undefined ? undefined : input.objectLiteralSelections.get(owner);
    if (selection?.kind === "provider-record") {
      return selection.fields.find((candidate) => candidate.element === parent)?.storageType;
    }
    const contribution = selection?.contributions.find((candidate) =>
      (candidate.kind === "field" || candidate.kind === "index-entry") && candidate.element === parent);
    return contribution?.kind === "field"
      ? contribution.fieldType
      : contribution?.kind === "index-entry"
        ? contribution.valueType
        : undefined;
  }
  const parentOperator = ast.operatorKindName(parent);
  if (ast.is.IsBinaryExpression(parent) && BinaryExpression_Right(ast, parent) === node &&
    parentOperator !== undefined && isMojoAssignmentOperator(parentOperator)) {
    const left = BinaryExpression_Left(ast, parent);
    if (left === undefined) return undefined;
    const property = input.propertySelections.get(left);
    const element = input.elementSelections.get(left);
    return property?.kind === "provider" || property?.kind === "provider-static"
      ? property.sourceWriteType
      : element?.kind === "provider"
        ? element.sourceWriteType
        : element?.writeType ?? input.expressionTypes.get(left);
  }
  if ((ast.is.IsAsExpression(parent) || ast.is.IsTypeAssertion(parent) ||
      ast.is.IsSatisfiesExpression(parent)) && Node_Expression(ast, parent) === node) {
    return input.expressionTypes.get(parent);
  }
  return undefined;
}

export function callArgumentExpectedType(
  selection: MojoCallSelection | undefined,
  expression: Node,
): MojoTargetTypeRef | undefined {
  if (selection === undefined) return undefined;
  if (selection.kind === "source-intrinsic") {
    return selection.operand === expression ? selection.resultType : undefined;
  }
  if (selection.kind === "project" || selection.kind === "provider" || selection.kind === "callable") {
    return selection.arguments.find((argument) => argument.expression === expression)?.parameterType;
  }
  if (selection.kind === "raw-pointer") {
    switch (selection.operation) {
      case "bind":
        return selection.identityExpression === expression ? selection.identityType : undefined;
      case "equal":
        if (selection.leftExpression === expression) return selection.leftType;
        return selection.rightExpression === expression ? selection.rightType : undefined;
      case "hash":
        return selection.pointerExpression === expression ? selection.pointerType : undefined;
    }
  }
  if (selection.kind === "explicit-safety") {
    return selection.form === "expression" && selection.expression === expression
      ? selection.resultType
      : undefined;
  }
  if (selection.kind === "native-pointer") {
    switch (selection.operation) {
      case "load":
        return selection.pointerExpression === expression ? selection.pointerType : undefined;
      case "store":
        if (selection.pointerExpression === expression) return selection.pointerType;
        return selection.valueExpression === expression ? selection.valueType : undefined;
      case "offset":
        if (selection.pointerExpression === expression) return selection.pointerType;
        return selection.offsetExpression === expression ? selection.offsetType : undefined;
    }
  }
  if (selection.kind !== "typed-location") return undefined;
  switch (selection.operation) {
    case "address-of":
      return undefined;
    case "allocate":
      return selection.initialExpression === expression ? selection.pointeeType : undefined;
    case "load":
      return selection.pointerExpression === expression ? selection.locationType : undefined;
    case "store":
      if (selection.pointerExpression === expression) return selection.locationType;
      return selection.valueExpression === expression ? selection.pointeeType : undefined;
    case "equal-pointer":
      return selection.leftExpression === expression || selection.rightExpression === expression
        ? selection.locationType
        : undefined;
  }
}
