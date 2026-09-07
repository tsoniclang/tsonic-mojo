import { tsonicUnsafeContextFactKey } from "@tsonic/source-core/facts";
import type { Node, ResolvedSourceCallInfo } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoCallSelection } from "../program/model.js";

export type MojoExplicitSafetyAnalysis =
  | { readonly kind: "not-explicit-safety" }
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoExplicitSafety(
  call: Node,
  sourceCall: ResolvedSourceCallInfo,
  source: TargetSourceProgram,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoExplicitSafetyAnalysis {
  const fact = source.sourceFacts.getFact(call, tsonicUnsafeContextFactKey);
  if (fact === undefined) return { kind: "not-explicit-safety" };
  if (fact.kind === "remaining-block") {
    return sourceCall.sourceArguments.length === 0
      ? {
          kind: "resolved",
          selection: Object.freeze({
            kind: "explicit-safety",
            form: "remaining-block",
            resultType: Object.freeze({ kind: "unit" }),
          }),
        }
      : unsupported("MOJO_UNSAFE_CONTEXT_EVIDENCE_CONFLICT", "The block unsafe marker selected a non-empty source argument list.");
  }
  if (sourceCall.sourceArguments.length !== 1 ||
    sourceCall.sourceArguments[0]!.expression !== fact.expression) {
    return unsupported(
      "MOJO_UNSAFE_CONTEXT_EVIDENCE_CONFLICT",
      "The expression unsafe marker does not own its exact selected source argument.",
    );
  }
  const resultType = expressionTypes.get(fact.expression);
  const sameSourceType = source.semantics.forNode(call).types.isIdentical(
    sourceCall.sourceArguments[0]!.type,
    sourceCall.sourceResultType,
  );
  if (resultType === undefined || !sameSourceType) {
    return unsupported(
      "MOJO_UNSAFE_CONTEXT_RESULT_NOT_CLOSED",
      "The explicit unsafe expression and marker result do not have one exact Mojo carrier.",
    );
  }
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "explicit-safety",
      form: "expression",
      expression: fact.expression,
      resultType,
    }),
  };
}

function unsupported(code: string, reason: string): MojoExplicitSafetyAnalysis {
  return { kind: "unsupported", code, reason };
}
