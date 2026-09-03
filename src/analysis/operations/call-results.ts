import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoCallSelection } from "../program/model.js";

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
