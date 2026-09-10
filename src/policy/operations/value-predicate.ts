import type { MojoNativeValuePredicate, MojoValuePredicateSelection } from "../../target-model/operations/value-predicate.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";

export function selectMojoValuePredicate(
  source: MojoTargetTypeRef,
  contract: MojoNativeValuePredicate,
): MojoValuePredicateSelection | undefined {
  if (source.kind === "type-parameter" || source.kind === "associated" ||
    source.kind === "compiler-expression") return undefined;
  if (mojoTargetTypeEquals(source, contract.acceptedType)) {
    return Object.freeze({ kind: "constant", value: true });
  }
  if (source.kind === "dynamic") {
    return source.domain === "js"
      ? Object.freeze({ kind: "boxed", operation: contract.boxed })
      : undefined;
  }
  if (source.kind === "optional") {
    const present = selectMojoValuePredicate(source.value, contract);
    return present === undefined ? undefined : Object.freeze({ kind: "optional", present });
  }
  if (source.kind === "union") {
    const members: { readonly type: MojoTargetTypeRef; readonly selection: MojoValuePredicateSelection }[] = [];
    for (const type of source.members) {
      const selection = selectMojoValuePredicate(type, contract);
      if (selection === undefined) return undefined;
      members.push(Object.freeze({ type, selection }));
    }
    return members.length === 0 ? undefined : Object.freeze({ kind: "union", members: Object.freeze(members) });
  }
  return Object.freeze({ kind: "constant", value: false });
}
