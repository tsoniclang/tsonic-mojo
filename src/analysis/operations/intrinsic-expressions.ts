import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoIntrinsicExpressionSelection } from "../program/model.js";
import { mojoPrimitiveRuntimeCategory } from "../../policy/types/primitive-runtime.js";
import type { MojoRuntimeCategory, MojoTypeofSelection } from "../../target-model/operations/typeof.js";

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
): MojoTypeofSelection | undefined {
  switch (type.kind) {
    case "null": return constant("object");
    case "undefined":
    case "unit": return constant("undefined");
    case "native-string": return constant("string");
    case "bigint": return constant("bigint");
    case "symbol": return constant("symbol");
    case "callable":
    case "function": return constant("function");
    case "source-primitive": {
      const category = mojoPrimitiveRuntimeCategory(type.name);
      return category === undefined ? undefined : constant(category);
    }
    case "target-named":
      return constant(type.id === "tsonic.mojo.js.JsString" ? "string" : "object");
    case "reference": return mojoTypeofResult(type.value);
    case "optional": {
      const present = mojoTypeofResult(type.value);
      return present === undefined ? undefined : Object.freeze({ kind: "optional", present });
    }
    case "union": {
      const members: Extract<MojoTypeofSelection, { kind: "union" }>["members"][number][] = [];
      for (const member of type.members) {
        const selection = mojoTypeofResult(member);
        if (selection === undefined) return undefined;
        members.push(Object.freeze({ type: member, selection }));
      }
      if (members.length === 0) return undefined;
      const first = members[0]!.selection;
      return first.kind === "constant" && members.every(({ selection }) => selection.kind === "constant" && selection.value === first.value)
        ? first : Object.freeze({ kind: "union", members: Object.freeze(members) });
    }
    case "list":
    case "fixed-array":
    case "dictionary":
    case "future":
    case "tuple": return constant("object");
    case "dynamic": return type.domain === "js" ? Object.freeze({ kind: "js-value" }) : undefined;
    case "never":
    case "type-parameter":
    case "associated":
    case "compiler-expression": return undefined;
  }
}

function constant(value: MojoRuntimeCategory): MojoTypeofSelection {
  return Object.freeze({ kind: "constant", value });
}
