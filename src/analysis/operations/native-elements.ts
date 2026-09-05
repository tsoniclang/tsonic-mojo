import type { ResolvedSourceElementAccessInfo } from "@tsonic/tsts";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoElementAnalysis, MojoElementAnalysisContext } from "./elements.js";

export function analyzeNativeElement(
  source: ResolvedSourceElementAccessInfo,
  accessMode: "read" | "write" | "read-write",
  receiver: MojoTargetTypeRef,
  index: MojoTargetTypeRef,
  context: MojoElementAnalysisContext,
): MojoElementAnalysis {
  const target = nativeElementContract(receiver, source.selectedElementIndex);
  if (target === undefined) {
    return unsupported(
      "MOJO_ELEMENT_TARGET_UNSUPPORTED",
      "Selected element receiver has no exact native Mojo element contract.",
    );
  }
  const indexConversion = context.conversions.record(source.argument.expression, index, target.indexType);
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_ELEMENT_INDEX_CONVERSION_UNPROVEN", indexConversion.reason);
  }
  let expressionType: MojoTargetTypeRef;
  let readResultConversion;
  if (source.sourceReadType !== undefined) {
    const conversion = classifyMojoValueConversion(target.valueType, target.valueType);
    expressionType = target.valueType;
    readResultConversion = conversion.kind === "resolved" ? conversion.conversion : undefined;
  } else {
    if (source.sourceWriteType === undefined) {
      return unsupported("MOJO_ELEMENT_WRITE_CARRIER_NOT_CLOSED", "Selected element write has no exact Mojo carrier.");
    }
    expressionType = target.valueType;
  }
  return {
    kind: "resolved",
    expressionType,
    selection: Object.freeze({
      kind: "native",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode,
      receiverType: receiver,
      indexType: target.indexType,
      ...(source.sourceReadType === undefined ? {} : { readType: target.valueType }),
      ...(source.sourceWriteType === undefined ? {} : { writeType: target.valueType }),
      indexConversion: indexConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      ...(source.selectedElementIndex === undefined
        ? {}
        : {
            selectedElementIndex: source.selectedElementIndex,
            sourceIndexType: index,
            evaluateSelectedIndex: expressionHasEffects(
              context.source.navigation.expressionEffects(source.argument.expression),
            ),
          }),
      optionalChain: source.optionalChain,
    }),
  };
}

function expressionHasEffects(effects: {
  readonly invokes: boolean;
  readonly mutates: boolean;
  readonly suspends: boolean;
  readonly mayThrow: boolean;
}): boolean {
  return effects.invokes || effects.mutates || effects.suspends || effects.mayThrow;
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
