import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "../operations/call-model.js";
import type { MojoSourceCallableSpecializationIssue, MojoSourceCallableSpecializationVariant } from "./specializations.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValuePredicateSelection } from "../../target-model/operations/value-predicate.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { selectMojoValuePredicate } from "../../policy/operations/value-predicate.js";

export function sealMojoValuePredicates(input: {
  readonly calls: Iterable<Node>;
  readonly selections: WeakMap<Node, MojoCallSelection>;
  readonly enclosingDeclaration: (node: Node) => Node | undefined;
  readonly variants: (declaration: Node) => readonly MojoSourceCallableSpecializationVariant[];
}): {
  readonly issues: readonly MojoSourceCallableSpecializationIssue[];
  selection(node: Node, type: MojoTargetTypeRef): MojoValuePredicateSelection | undefined;
} {
  const index = new WeakMap<Node, ReadonlyMap<string, MojoValuePredicateSelection>>();
  const issues: MojoSourceCallableSpecializationIssue[] = [];
  for (const node of input.calls) {
    const call = input.selections.get(node);
    if (call?.kind !== "provider" || call.operation.target.kind !== "value-predicate") continue;
    const argument = call.arguments[0];
    if (call.arguments.length !== 1 || argument === undefined || argument.sourceForm === "spread-sequence" || call.optionalChain) {
      issues.push({ node, code: "MOJO_VALUE_PREDICATE_ARITY_CONFLICT", message: "A native value predicate requires one exact source argument." });
      continue;
    }
    const direct = selectMojoValuePredicate(argument.sourceType, call.operation.target.predicate);
    const selections = new Map<string, MojoValuePredicateSelection>();
    if (direct !== undefined) selections.set(mojoTargetTypeKey(argument.sourceType), direct);
    else {
      const owner = input.enclosingDeclaration(node);
      for (const variant of owner === undefined ? [] : input.variants(owner)) {
        const type = substituteMojoTargetType(argument.sourceType, variant.substitutions);
        const selected = selectMojoValuePredicate(type, call.operation.target.predicate);
        if (selected === undefined) {
          issues.push({ node, code: "MOJO_VALUE_PREDICATE_SPECIALIZATION_UNCLOSED", message: "A required native value predicate retains an unclosed source carrier." });
        } else selections.set(mojoTargetTypeKey(type), selected);
      }
      if (selections.size === 0) {
        issues.push({ node, code: "MOJO_VALUE_PREDICATE_SPECIALIZATION_MISSING", message: "A native value predicate requires a finite selected carrier before planning." });
      }
    }
    index.set(node, selections);
  }
  return Object.freeze({
    issues: Object.freeze(issues),
    selection(node: Node, type: MojoTargetTypeRef) { return index.get(node)?.get(mojoTargetTypeKey(type)); },
  });
}
