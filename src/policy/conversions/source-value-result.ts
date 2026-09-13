import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";

export function selectMojoSourceValueResult(
  targetType: MojoTargetTypeRef,
): MojoValueConversion | undefined {
  if (targetType.kind === "dynamic" && targetType.domain === "js") {
    return Object.freeze({ kind: "identity" });
  }
  const name = targetType.kind === "null"
    ? "js_value_null"
    : targetType.kind === "undefined"
      ? "js_value_undefined"
    : targetType.kind === "native-string"
    ? "js_value_native_string"
    : targetType.kind === "source-primitive" && targetType.name === "float64"
      ? "js_value_number"
      : targetType.kind === "source-primitive" && targetType.name === "bool"
        ? "js_value_bool"
        : undefined;
  return name === undefined ? undefined : Object.freeze({
    kind: "js-value-extract",
    sourceType: Object.freeze({ kind: "dynamic", domain: "js" }),
    targetType,
    extraction: Object.freeze({
      modulePath: Object.freeze(["tsonic_js", "value", "extraction"]),
      name,
    }),
  });
}
