import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, PrefixUnaryExpression_Operand } from "@tsonic/target-api/source";
import { mojoBitwiseOperators, selectMojoNumericOperation } from "../../policy/operations/numeric.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoIntrinsicExpressionSelection } from "../program/model.js";
import { isMojoAssignmentOperator } from "../program/syntax-validation.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";

export function analyzeMojoNumericOperation(
  node: Node,
  ast: AstReader,
  types: WeakMap<Node, MojoTargetTypeRef>,
): Extract<MojoIntrinsicExpressionSelection, { readonly kind: "numeric" }> | "unclosed" | undefined {
  if (!ast.is.IsBinaryExpression(node) && !ast.is.IsPrefixUnaryExpression(node)) return undefined;
  const token = ast.operatorKindName(node);
  const operator = mojoBitwiseOperators.get(token ?? "");
  if (operator === undefined) return undefined;
  const operand = ast.is.IsBinaryExpression(node) ? BinaryExpression_Left(ast, node) : PrefixUnaryExpression_Operand(ast, node);
  const right = ast.is.IsBinaryExpression(node) ? BinaryExpression_Right(ast, node) : undefined;
  const leftType = operand === undefined ? undefined : types.get(operand);
  const rightType = right === undefined ? undefined : types.get(right);
  const result = types.get(node);
  if (operand === undefined || leftType === undefined || result === undefined ||
    (right !== undefined && rightType === undefined)) return "unclosed";
  const nativeLiteralRight = right !== undefined && ast.is.IsNumericLiteral(right) &&
    leftType.kind === "source-primitive" && result.kind === "source-primitive" &&
    result.name === leftType.name && result.name !== "float32" && result.name !== "float64";
  const operation = selectMojoNumericOperation(operator, leftType, rightType, result, nativeLiteralRight);
  if (operation === undefined) return "unclosed";
  const compound = token !== undefined && isMojoAssignmentOperator(token);
  const write = compound ? classifyMojoValueConversion(operation.resultType, leftType) : undefined;
  if (write?.kind === "unsupported") return "unclosed";
  const writeConversion = write?.kind === "resolved" ? write.conversion : undefined;
  if (writeConversion !== undefined && writeConversion.kind !== "identity" &&
    writeConversion.kind !== "primitive-cast") return "unclosed";
  return Object.freeze({
    kind: "numeric",
    operand,
    ...(right === undefined ? {} : { right }),
    operation,
    ...(writeConversion === undefined ? {} : { writeConversion }),
    resultType: compound ? leftType : operation.resultType,
  });
}
