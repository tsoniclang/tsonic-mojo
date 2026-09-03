import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import {
  classifyMojoValueConversion,
} from "../../policy/conversions/selection.js";
import type {
  MojoConversionClassification,
} from "../../policy/conversions/selection.js";
import type { MojoValueConversionNarrowing } from "../../target-model/conversions/model.js";
import type { MojoValueRefinementSelection } from "./model.js";

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

export function mojoValueConversionNarrowing(
  refinement: MojoValueRefinementSelection | undefined,
): MojoValueConversionNarrowing | undefined {
  return refinement?.kind === "union-subset"
    ? Object.freeze({
        sourceType: refinement.sourceType,
        selectedType: refinement.resultType,
      })
    : undefined;
}

export function classifyMojoRefinedValueConversion(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
  refinement: MojoValueRefinementSelection | undefined,
): MojoConversionClassification {
  return classifyMojoValueConversion(
    actual,
    expected,
    mojoValueConversionNarrowing(refinement),
  );
}
