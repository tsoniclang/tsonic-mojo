import type { MojoValueConversion } from "../../target-model/conversions/model.js";
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

export function mojoConvertedValueType(
  input: MojoTargetTypeRef,
  conversion: MojoValueConversion,
): MojoTargetTypeRef {
  if (conversion.kind === "identity") return input;
  if (conversion.kind === "js-to-native-string") {
    return Object.freeze({ kind: "native-string" });
  }
  if (conversion.kind === "js-truthiness") {
    return Object.freeze({ kind: "source-primitive", name: "bool" });
  }
  if (conversion.kind === "native-error-result-unwrap") return conversion.targetType;
  return conversion.targetType;
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
