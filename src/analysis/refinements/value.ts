import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoValueRefinementSelection } from "../program/model.js";

export function classifyMojoValueRefinement(
  sourceType: MojoTargetTypeRef,
  resultType: MojoTargetTypeRef,
): MojoValueRefinementSelection | undefined {
  if (sourceType.kind === "optional" &&
    mojoTargetTypeEquals(sourceType.value, resultType)) {
    return Object.freeze({ kind: "optional-present", sourceType, resultType });
  }
  if (sourceType.kind === "union" &&
    sourceType.members.some((member) => mojoTargetTypeEquals(member, resultType))) {
    return Object.freeze({ kind: "union-member", sourceType, resultType });
  }
  if (sourceType.kind === "union" && resultType.kind === "union" &&
    resultType.members.length > 0 && resultType.members.every((member) =>
      sourceType.members.some((sourceMember) => mojoTargetTypeEquals(sourceMember, member)))) {
    return Object.freeze({ kind: "union-subset", sourceType, resultType });
  }
  return undefined;
}
