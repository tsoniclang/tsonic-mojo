import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export function mojoAwaitOperandIssue(
  type: MojoTargetTypeRef | undefined,
): { readonly code: string; readonly message: string } | undefined {
  if (type?.kind !== "future") {
    return Object.freeze({
      code: "MOJO_AWAIT_OPERAND_NOT_CLOSED",
      message: "Await requires one exact finalized Mojo future carrier.",
    });
  }
  if (type.domain === "js") {
    return Object.freeze({
      code: "MOJO_JS_PROMISE_AWAIT_RUNTIME_MISSING",
      message: "JavaScript Promise awaiting requires the closed Mojo JS scheduler contract.",
    });
  }
  return undefined;
}

export function analyzeMojoAwaitExpressions(
  expressions: ReadonlySet<Node>,
  ast: AstReader,
  types: WeakMap<Node, MojoTargetTypeRef>,
): readonly TargetDiagnostic[] {
  const diagnostics: TargetDiagnostic[] = [];
  for (const expression of expressions) {
    const operand = Node_Expression(ast, expression);
    const issue = mojoAwaitOperandIssue(operand === undefined ? undefined : types.get(operand));
    if (issue !== undefined) diagnostics.push(Object.freeze({
      ...issue,
      sourceNode: expression,
      category: "error",
      source: "tsonic-mojo",
      evidence: Object.freeze(["target.capability=mojo.analysis.await"]),
    }));
  }
  return Object.freeze(diagnostics);
}
