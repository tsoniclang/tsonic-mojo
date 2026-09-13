import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { mojoSourceValueEqualityKind } from "../../policy/operations/source-value-equality.js";
import type { MojoExecutableRegionAnalysisInput } from "../control-flow/analyze.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";

export function analyzeMojoSourceValueEquality(node: Node, input: MojoExecutableRegionAnalysisInput): void {
  if (input.typeTestSelections.has(node)) return;
  const { ast } = input.source;
  const left = BinaryExpression_Left(ast, node);
  const right = BinaryExpression_Right(ast, node);
  const leftType = left === undefined ? undefined : input.expressionTypes.get(left);
  const rightType = right === undefined ? undefined : input.expressionTypes.get(right);
  const kind = mojoSourceValueEqualityKind(ast.operatorKindName(node), leftType, rightType);
  if (kind === undefined || left === undefined || right === undefined ||
    leftType === undefined || rightType === undefined) return;
  if (kind === "coercive") {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_SOURCE_VALUE_COERCIVE_EQUALITY_UNSUPPORTED",
      "Coercive equality of erased source values requires a complete selected primitive-conversion protocol; strict equality is available.", node,
    ));
    return;
  }
  const operandType = Object.freeze({ kind: "dynamic" as const, domain: "js" as const });
  for (const [operand, type] of [[left, leftType], [right, rightType]] as const) {
    const conversion = input.conversions.record(operand, type, operandType);
    if (conversion.kind === "unsupported") {
      input.diagnostics.push(mojoAnalysisDiagnostic("MOJO_VALUE_CONVERSION_UNPROVEN", conversion.reason, operand));
      return;
    }
  }
  input.typeTestSelections.set(node, Object.freeze({
    kind: "source-value-equality", left, right, operandType, equal: kind === "equal",
  }));
}
