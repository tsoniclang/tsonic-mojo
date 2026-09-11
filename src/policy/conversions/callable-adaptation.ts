import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoCopyCapability } from "../../target-model/lifecycle/model.js";
import { mojoConversionRaises } from "../../target-model/conversions/effects.js";

export function classifyCallableAdaptation(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
  classifyError: (actual: MojoTargetTypeRef, expected: MojoTargetTypeRef) => MojoValueConversion | undefined,
  parameterCopy?: (type: MojoTargetTypeRef) => MojoCopyCapability,
  classifyResult?: (actual: MojoTargetTypeRef, expected: MojoTargetTypeRef) => MojoValueConversion | undefined,
): Extract<MojoValueConversion, { readonly kind: "callable-adapt" }> | undefined {
  if (actual.kind !== "callable" || expected.kind !== "callable") return undefined;
  if (actual.parameters.length > expected.parameters.length) return undefined;
  const prefix = actual.parameters.length < expected.parameters.length;
  const argumentCopies: ("implicit" | "explicit")[] = [];
  if (prefix) {
    if ([...actual.parameters, ...expected.parameters].some((parameter) =>
      parameter.convention !== "imm" || parameter.passing !== "plain" ||
      parameter.omissionKind === "rest")) return undefined;
    for (const parameter of actual.parameters) {
      const copy = parameterCopy?.(parameter.type);
      if (copy !== "implicit" && copy !== "explicit") return undefined;
      argumentCopies.push(copy);
    }
  }
  const sameResult = mojoTargetTypeEquals(actual.result, expected.result);
  const resultConversion = !sameResult && actual.result.kind !== "never"
    ? classifyResult?.(actual.result, expected.result) : undefined;
  const result = sameResult
    ? "preserve" as const
    : actual.result.kind === "never"
      ? "never" as const
      : resultConversion !== undefined && !mojoConversionRaises(resultConversion)
        ? "convert" as const : undefined;
  if (result === undefined) return undefined;
  let error: "preserve" | "widen" | "erase";
  let errorConversion: MojoValueConversion | undefined;
  const actualErrorType = actual.raises
    ? actual.errorType ?? mojoNativeErrorType
    : undefined;
  const expectedErrorType = expected.raises
    ? expected.errorType ?? mojoNativeErrorType
    : undefined;
  if (actual.raises === expected.raises && (!actual.raises || mojoTargetTypeEquals(
    actualErrorType!,
    expectedErrorType!,
  ))) {
    error = "preserve";
  } else if (!actual.raises && expected.raises) {
    error = "widen";
  } else if (actual.raises && expected.raises &&
    !isNativeErrorType(actual.errorType) && isNativeErrorType(expected.errorType)) {
    error = "erase";
  } else if (actualErrorType !== undefined && expectedErrorType !== undefined) {
    errorConversion = classifyError(actualErrorType, expectedErrorType);
    if (errorConversion === undefined) return undefined;
    error = "widen";
  } else {
    return undefined;
  }
  const { errorType: _actualErrorType, ...actualBase } = actual;
  const normalized = Object.freeze({
    ...actualBase,
    result: expected.result,
    raises: expected.raises,
    ...(expected.errorType === undefined ? {} : { errorType: expected.errorType }),
  });
  if (!mojoTargetTypeEquals(
    Object.freeze({ ...normalized, parameters: actual.parameters }),
    Object.freeze({ ...expected, parameters: expected.parameters.slice(0, actual.parameters.length) }),
  )) return undefined;
  return Object.freeze({
    kind: "callable-adapt",
    sourceType: actual,
    targetType: expected,
    parameters: prefix ? Object.freeze({ kind: "prefix", copies: Object.freeze(argumentCopies) }) : Object.freeze({ kind: "identity" }),
    ...(result === "convert" ? { result, resultConversion: resultConversion! } : { result }),
    error,
    ...(actualErrorType === undefined ? {} : { sourceErrorType: actualErrorType }),
    ...(errorConversion === undefined
      ? {}
      : { errorConversion }),
  });
}

const mojoNativeErrorType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "mojo.builtin.Error",
  modulePath: Object.freeze([]),
  name: "Error",
});

function isNativeErrorType(type: MojoTargetTypeRef | undefined): boolean {
  return type === undefined || (type.kind === "target-named" &&
    type.id === "mojo.builtin.Error");
}
