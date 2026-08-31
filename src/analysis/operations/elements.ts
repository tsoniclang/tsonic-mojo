import type { ResolvedSourceElementAccessInfo, Type } from "@tsonic/tsts";
import type { MojoConversionIndex } from "../conversions/classification.js";
import type { MojoElementSelection } from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";

export type MojoElementAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoElementSelection; readonly expressionType: MojoTargetTypeRef }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoElementAccess(
  source: ResolvedSourceElementAccessInfo,
  resolveType: (type: Type) => MojoTargetTypeRef | undefined,
  conversions: MojoConversionIndex,
): MojoElementAnalysis {
  if (source.optionalChain) {
    return unsupported(
      "MOJO_OPTIONAL_ELEMENT_ACCESS_UNSUPPORTED",
      "Optional element access requires a sealed short-circuit evaluation region.",
    );
  }
  if (source.callCallee) {
    return unsupported(
      "MOJO_ELEMENT_CALL_CALLEE_UNSUPPORTED",
      "Calling an element-selected callable requires a sealed callable-value ABI.",
    );
  }
  if (source.accessMode === "delete") {
    return unsupported(
      "MOJO_ELEMENT_DELETE_UNSUPPORTED",
      "Selected element access has no exact target delete operation.",
    );
  }
  const receiver = resolveType(source.receiver.type);
  const index = resolveType(source.argument.type);
  if (receiver === undefined || index === undefined) {
    return unsupported(
      "MOJO_ELEMENT_OPERAND_CARRIER_NOT_CLOSED",
      "Selected element receiver or index has no exact Mojo carrier.",
    );
  }
  const target = nativeElementContract(receiver, source.selectedElementIndex);
  if (target === undefined) {
    return unsupported(
      "MOJO_ELEMENT_TARGET_UNSUPPORTED",
      "Selected element receiver has no exact native Mojo element contract.",
    );
  }
  const indexConversion = conversions.record(source.argument.expression, index, target.indexType);
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_ELEMENT_INDEX_CONVERSION_UNPROVEN", indexConversion.reason);
  }
  let expressionType: MojoTargetTypeRef;
  let readResultConversion;
  if (source.sourceReadType !== undefined) {
    const sourceRead = resolveType(source.sourceReadType);
    if (sourceRead === undefined) {
      return unsupported("MOJO_ELEMENT_READ_CARRIER_NOT_CLOSED", "Selected element read has no exact Mojo carrier.");
    }
    const conversion = conversions.record(source.expression, target.valueType, sourceRead);
    if (conversion.kind === "unsupported") {
      return unsupported("MOJO_ELEMENT_READ_CONVERSION_UNPROVEN", conversion.reason);
    }
    expressionType = sourceRead;
    readResultConversion = conversion.conversion;
  } else {
    const sourceWrite = source.sourceWriteType === undefined ? undefined : resolveType(source.sourceWriteType);
    if (sourceWrite === undefined) {
      return unsupported("MOJO_ELEMENT_WRITE_CARRIER_NOT_CLOSED", "Selected element write has no exact Mojo carrier.");
    }
    expressionType = sourceWrite;
  }
  return {
    kind: "resolved",
    expressionType,
    selection: Object.freeze({
      kind: "native",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode: source.accessMode,
      receiverType: receiver,
      indexType: target.indexType,
      ...(source.sourceReadType === undefined ? {} : { readType: target.valueType }),
      ...(source.sourceWriteType === undefined ? {} : { writeType: target.valueType }),
      indexConversion: indexConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      ...(source.selectedElementIndex === undefined ? {} : { selectedElementIndex: source.selectedElementIndex }),
    }),
  };
}

function nativeElementContract(
  receiver: MojoTargetTypeRef,
  selectedElementIndex: number | undefined,
): { readonly indexType: MojoTargetTypeRef; readonly valueType: MojoTargetTypeRef } | undefined {
  const nativeIndex: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: "native-int" });
  switch (receiver.kind) {
    case "list": return { indexType: nativeIndex, valueType: receiver.element };
    case "fixed-array": return { indexType: nativeIndex, valueType: receiver.element };
    case "dictionary": return { indexType: receiver.key, valueType: receiver.value };
    case "tuple": {
      const element = selectedElementIndex === undefined ? undefined : receiver.elements[selectedElementIndex];
      return element === undefined ? undefined : { indexType: nativeIndex, valueType: element };
    }
    default: return undefined;
  }
}

function unsupported(code: string, reason: string): MojoElementAnalysis {
  return { kind: "unsupported", code, reason };
}
