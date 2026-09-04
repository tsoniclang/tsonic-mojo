import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoIntrinsicExpressionSelection } from "../program/model.js";

export type MojoIntrinsicExpressionAnalysis =
  | { readonly kind: "not-intrinsic" }
  | { readonly kind: "resolved"; readonly selection: MojoIntrinsicExpressionSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoIntrinsicExpression(
  expression: Node,
  ast: AstReader,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoIntrinsicExpressionAnalysis {
  if (!ast.is.IsTypeOfExpression(expression) && !ast.is.IsVoidExpression(expression)) {
    return { kind: "not-intrinsic" };
  }
  const operand = Node_Expression(ast, expression);
  const operandType = operand === undefined ? undefined : expressionTypes.get(operand);
  if (operand === undefined || operandType === undefined) {
    return {
      kind: "unsupported",
      code: ast.is.IsTypeOfExpression(expression)
        ? "MOJO_TYPEOF_OPERAND_CARRIER_UNRESOLVED"
        : "MOJO_VOID_OPERAND_CARRIER_UNRESOLVED",
      reason: `${ast.is.IsTypeOfExpression(expression) ? "typeof" : "void"} requires one exact sealed operand carrier.`,
    };
  }
  if (ast.is.IsVoidExpression(expression)) {
    return {
      kind: "resolved",
      selection: Object.freeze({
        kind: "void",
        operand,
        resultType: Object.freeze({ kind: "undefined" }),
      }),
    };
  }
  const result = mojoTypeofResult(operandType);
  return result === undefined
    ? {
        kind: "unsupported",
        code: "MOJO_TYPEOF_RUNTIME_CATEGORY_UNRESOLVED",
        reason: "typeof requires one exact TypeScript runtime category for the sealed Mojo operand carrier.",
      }
    : {
        kind: "resolved",
        selection: Object.freeze({
          kind: "typeof",
          operand,
          result,
          resultType: Object.freeze({ kind: "native-string" }),
        }),
      };
}

function mojoTypeofResult(
  type: MojoTargetTypeRef,
): Extract<MojoIntrinsicExpressionSelection, { readonly kind: "typeof" }>["result"] | undefined {
  switch (type.kind) {
    case "null": return "object";
    case "undefined":
    case "unit": return "undefined";
    case "native-string": return "string";
    case "bigint": return "bigint";
    case "symbol": return "symbol";
    case "callable":
    case "function": return "function";
    case "source-primitive":
      if (type.name === "bool") return "boolean";
      if (type.name === "char") return "string";
      return type.name === "int64" || type.name === "uint64" ||
        type.name === "int128" || type.name === "uint128"
        ? "bigint"
        : "number";
    case "target-named":
      return type.id === "tsonic.mojo.js.JsString" ? "string" : "object";
    case "reference": return mojoTypeofResult(type.value);
    case "optional": return commonTypeofResult([type.value, Object.freeze({ kind: "undefined" })]);
    case "union": return commonTypeofResult(type.members);
    case "list":
    case "fixed-array":
    case "dictionary":
    case "future":
    case "tuple": return "object";
    case "never":
    case "dynamic":
    case "type-parameter":
    case "associated":
    case "compiler-expression": return undefined;
  }
}

function commonTypeofResult(
  types: readonly MojoTargetTypeRef[],
): Extract<MojoIntrinsicExpressionSelection, { readonly kind: "typeof" }>["result"] | undefined {
  let result: ReturnType<typeof mojoTypeofResult>;
  for (const type of types) {
    const candidate = mojoTypeofResult(type);
    if (candidate === undefined || (result !== undefined && candidate !== result)) return undefined;
    result = candidate;
  }
  return result;
}
