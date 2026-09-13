import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoAnalyzedCallArgument, MojoCallSelection } from "../operations/call-model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";

export function finalizeMojoFirstClassCallArguments(
  references: ReadonlyMap<Node, Extract<MojoTargetTypeRef, { readonly kind: "callable" }>>,
  calls: ReadonlySet<Node>,
  selections: WeakMap<Node, MojoCallSelection>,
  conversions: MojoConversionIndex,
  diagnostics: TargetDiagnostic[],
): void {
  for (const call of calls) {
    const selection = selections.get(call);
    if (selection?.kind !== "project" && selection?.kind !== "provider" && selection?.kind !== "callable") continue;
    const replacements = new Map<MojoAnalyzedCallArgument, MojoAnalyzedCallArgument>();
    const arguments_ = selection.arguments.map((argument) => {
      const sourceType = references.get(argument.expression);
      if (argument.sourceForm !== "value" || sourceType === undefined ||
        argument.conversion.kind === "js-callback-truthiness") return argument;
      const classified = conversions.classify(sourceType, argument.parameterType);
      if (classified.kind === "unsupported") {
        diagnostics.push(mojoAnalysisDiagnostic("MOJO_CALLABLE_ARGUMENT_FINAL_CONVERSION_UNPROVEN",
          classified.reason, argument.expression));
        return argument;
      }
      const finalized = Object.freeze({ ...argument, sourceType, conversion: classified.conversion });
      replacements.set(argument, finalized);
      return finalized;
    });
    if (replacements.size === 0) continue;
    selections.set(call, Object.freeze({ ...selection, arguments: Object.freeze(arguments_),
      ...(selection.kind !== "callable" ? {} : {
        argumentSlots: Object.freeze(selection.argumentSlots.map((slot) => slot.kind === "value"
          ? Object.freeze({ ...slot, argument: replacements.get(slot.argument) ?? slot.argument })
          : slot.kind === "rest"
            ? Object.freeze({ ...slot, arguments: Object.freeze(slot.arguments.map((argument) =>
                replacements.get(argument) ?? argument)) })
            : slot)),
      }),
    }));
  }
}
