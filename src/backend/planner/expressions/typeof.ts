import type { MojoTypeofSelection } from "../../../target-model/operations/typeof.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function planMojoTypeof(
  value: MojoExpression,
  selection: MojoTypeofSelection,
  context: MojoPlanningContext,
): MojoExpression {
  switch (selection.kind) {
    case "constant": return { kind: "string-literal", value: selection.value };
    case "js-value": return { kind: "method-call", receiver: value, name: "type_of", arguments: [] };
    case "optional": return {
      kind: "conditional",
      condition: { kind: "construct", type: { kind: "source-primitive", name: "bool" }, arguments: [{ value }] },
      whenTrue: planMojoTypeof({ kind: "method-call", receiver: value, name: "value", arguments: [] }, selection.present, context),
      whenFalse: { kind: "string-literal", value: "undefined" },
    };
    case "union": {
      let result: MojoExpression | undefined;
      for (const member of [...selection.members].reverse()) {
        registerMojoTypeImports(member.type, context);
        const selected = planMojoTypeof({ kind: "proven-union-member", receiver: value, type: member.type }, member.selection, context);
        result = result === undefined ? selected : {
          kind: "conditional",
          condition: { kind: "method-call", receiver: value, name: "isa", genericArguments: [{ kind: "type", type: member.type }], arguments: [] },
          whenTrue: selected,
          whenFalse: result,
        };
      }
      if (result === undefined) throw new Error("A sealed typeof union has no members.");
      return result;
    }
  }
}
