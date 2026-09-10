import type { MojoValuePredicateSelection } from "../../../target-model/operations/value-predicate.js";
import type { MojoExpression } from "../../target-ast/index.js";
import { mojoModulePathExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function planMojoValuePredicate(
  value: MojoExpression,
  selection: MojoValuePredicateSelection,
  context: MojoPlanningContext,
): MojoExpression {
  switch (selection.kind) {
    case "constant": return { kind: "bool-literal", value: selection.value };
    case "boxed": return {
      kind: "call",
      callee: mojoModulePathExpression(context, selection.operation.modulePath, [selection.operation.name]),
      arguments: [{ value }],
    };
    case "optional": return {
      kind: "conditional",
      condition: { kind: "construct", type: { kind: "source-primitive", name: "bool" }, arguments: [{ value }] },
      whenTrue: planMojoValuePredicate({ kind: "method-call", receiver: value, name: "value", arguments: [] }, selection.present, context),
      whenFalse: { kind: "bool-literal", value: false },
    };
    case "union": {
      let result: MojoExpression | undefined;
      for (const member of [...selection.members].reverse()) {
        registerMojoTypeImports(member.type, context);
        const selected = planMojoValuePredicate({ kind: "proven-union-member", receiver: value, type: member.type }, member.selection, context);
        result = result === undefined ? selected : {
          kind: "conditional",
          condition: { kind: "method-call", receiver: value, name: "isa", genericArguments: [{ kind: "type", type: member.type }], arguments: [] },
          whenTrue: selected,
          whenFalse: result,
        };
      }
      if (result === undefined) throw new Error("A sealed native value predicate has no union members.");
      return result;
    }
  }
}
