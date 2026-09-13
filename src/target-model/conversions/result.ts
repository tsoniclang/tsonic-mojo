import type { MojoValueConversion } from "./model.js";
import type { MojoTargetTypeRef } from "../types/model.js";

export function mojoConvertedValueType(
  input: MojoTargetTypeRef,
  conversion: MojoValueConversion,
): MojoTargetTypeRef {
  if (conversion.kind === "identity") return input;
  if (conversion.kind === "undefined-to-unit") return Object.freeze({ kind: "unit" });
  if (conversion.kind === "js-to-native-string") {
    return Object.freeze({ kind: "native-string" });
  }
  if (conversion.kind === "js-truthiness") {
    return Object.freeze({ kind: "source-primitive", name: "bool" });
  }
  if (conversion.kind === "native-error-result-unwrap") return conversion.targetType;
  return conversion.targetType;
}
