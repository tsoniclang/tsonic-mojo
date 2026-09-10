import { mojoConvertedValueType } from "../../target-model/conversions/result.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoCallSelection } from "../program/model.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";

export function mojoCallResultType(
  selection: MojoCallSelection,
): MojoTargetTypeRef {
  if (selection.kind !== "provider") return selection.resultType;
  return mojoConvertedValueType(selection.operation.resultType, selection.resultConversion);
}

export function classifyMojoSourceResultConversion(
  input: MojoTargetTypeRef,
  selectedSourceType: MojoTargetTypeRef,
  projectRelationships?: MojoProjectTypeRelationships,
): ReturnType<typeof classifyMojoValueConversion> {
  if (selectedSourceType.kind === "dynamic" && selectedSourceType.domain === "source") {
    return Object.freeze({
      kind: "resolved" as const,
      conversion: Object.freeze({ kind: "identity" as const }),
    });
  }
  return classifyMojoValueConversion(
    input,
    selectedSourceType,
    undefined,
    projectRelationships,
  );
}
