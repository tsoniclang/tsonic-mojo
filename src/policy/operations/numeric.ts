import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoBitwiseOperator, MojoNumericOperation } from "../../target-model/operations/numeric.js";
import { classifyMojoValueConversion } from "../conversions/selection.js";

const sourceNumber: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: "float64" });

const runtimeOperations: Readonly<Record<MojoBitwiseOperator, string>> = Object.freeze({
  "~": "source_number_bitwise_not",
  "&": "source_number_bitwise_and",
  "|": "source_number_bitwise_or",
  "^": "source_number_bitwise_xor",
  "<<": "source_number_shift_left",
  ">>": "source_number_shift_right",
  ">>>": "source_number_unsigned_shift_right",
});

export const mojoBitwiseOperators: ReadonlyMap<string, MojoBitwiseOperator> = new Map([
  ["KindTildeToken", "~"],
  ["KindAmpersandToken", "&"], ["KindAmpersandEqualsToken", "&"],
  ["KindBarToken", "|"], ["KindBarEqualsToken", "|"],
  ["KindCaretToken", "^"], ["KindCaretEqualsToken", "^"],
  ["KindLessThanLessThanToken", "<<"], ["KindLessThanLessThanEqualsToken", "<<"],
  ["KindGreaterThanGreaterThanToken", ">>"], ["KindGreaterThanGreaterThanEqualsToken", ">>"],
  ["KindGreaterThanGreaterThanGreaterThanToken", ">>>"],
  ["KindGreaterThanGreaterThanGreaterThanEqualsToken", ">>>"],
]);

const unsignedPrimitives = Object.freeze({
  int8: "uint8", uint8: "uint8", int16: "uint16", uint16: "uint16",
  int32: "uint32", uint32: "uint32", int64: "uint64", uint64: "uint64",
  int128: "uint128", uint128: "uint128", "native-int": "native-uint", "native-uint": "native-uint",
} as const);

export function selectMojoNumericOperation(
  operator: MojoBitwiseOperator,
  left: MojoTargetTypeRef,
  right: MojoTargetTypeRef | undefined,
  result: MojoTargetTypeRef,
  nativeLiteralRight = false,
): MojoNumericOperation | undefined {
  if (left.kind === "bigint" && (right === undefined || right.kind === "bigint") && operator !== ">>>") {
    return Object.freeze({
      operator,
      implementation: Object.freeze({ kind: "native" }),
      operandType: left,
      leftConversion: Object.freeze({ kind: "identity" }),
      ...(right === undefined ? {} : { rightConversion: Object.freeze({ kind: "identity" as const }) }),
      resultType: result,
    });
  }
  if (!isNumeric(left) || (right !== undefined && !isNumeric(right))) return undefined;
  const numberOperation = isFloating(left) ||
    (right !== undefined && isFloating(right) && !nativeLiteralRight);
  const operandType = numberOperation ? sourceNumber : left;
  const resultType = numberOperation ? sourceNumber : left;
  const leftConversion = classifyMojoValueConversion(left, operandType);
  const rightConversion = right === undefined ? undefined : classifyMojoValueConversion(right, operandType);
  if (leftConversion.kind !== "resolved" || rightConversion?.kind === "unsupported") return undefined;
  const rightValueConversion = rightConversion?.kind === "resolved" ? rightConversion.conversion : undefined;
  if (leftConversion.conversion.kind !== "identity" && leftConversion.conversion.kind !== "primitive-cast") return undefined;
  if (rightValueConversion !== undefined && rightValueConversion.kind !== "identity" &&
    rightValueConversion.kind !== "primitive-cast") return undefined;
  const unsignedName = left.name in unsignedPrimitives
    ? unsignedPrimitives[left.name as keyof typeof unsignedPrimitives]
    : undefined;
  if (!numberOperation && operator === ">>>" && unsignedName === undefined) return undefined;
  return Object.freeze({
    operator,
    implementation: numberOperation
      ? Object.freeze({ kind: "source-number", name: runtimeOperations[operator] })
      : Object.freeze({
          kind: "native",
          ...(operator === ">>>" && unsignedName !== undefined
            ? { unsignedType: Object.freeze({ kind: "source-primitive" as const, name: unsignedName }) }
            : {}),
        }),
    operandType,
    leftConversion: leftConversion.conversion,
    ...(rightValueConversion === undefined ? {} : { rightConversion: rightValueConversion }),
    resultType,
  });
}

function isNumeric(type: MojoTargetTypeRef): type is Extract<MojoTargetTypeRef, { readonly kind: "source-primitive" }> {
  return type.kind === "source-primitive" && type.name !== "bool" && type.name !== "char";
}

function isFloating(type: Extract<MojoTargetTypeRef, { readonly kind: "source-primitive" }>): boolean {
  return type.name === "float16" || type.name === "float32" || type.name === "float64";
}
