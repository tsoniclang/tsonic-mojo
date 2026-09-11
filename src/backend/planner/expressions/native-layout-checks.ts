import type { MojoNativeLayout } from "../../../target-model/operations/native-memory.js";
import type { MojoTargetGenericArgument } from "../../../target-model/types/model.js";
import type { MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function planMojoNativeLayoutChecks(layout: MojoNativeLayout, context: MojoPlanningContext): readonly MojoStatement[] {
  const statements: MojoStatement[] = [];
  visit(layout, true);
  return Object.freeze(statements);

  function check(name: string, parameters: readonly MojoTargetGenericArgument[]): void {
    statements.push(Object.freeze({ kind: "expression", expression: Object.freeze({ kind: "call",
      callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], name),
      genericArguments: Object.freeze(parameters), arguments: Object.freeze([]) }) }));
  }

  function visit(selected: MojoNativeLayout, root: boolean): void {
    registerMojoTypeImports(selected.type, context);
    if (!root) check("require_native_layout", [
      { kind: "type", type: selected.type }, integer(selected.byteSize), integer(selected.byteAlignment),
      integer(selected.stride), integer(selected.addressWidth), { kind: "boolean", value: selected.littleEndian },
    ]);
    if (selected.element !== undefined) visit(selected.element, false);
    if (selected.fields.length === 0) return;
    check("require_native_field_count", [{ kind: "type", type: selected.type }, integer(selected.fields.length)]);
    for (const field of selected.fields) {
      visit(field.layout, false);
      check("require_native_field", [
        { kind: "type", type: selected.type }, { kind: "type", type: field.layout.type },
        { kind: "static-string", value: field.name }, integer(field.byteOffset),
      ]);
    }
  }
}

function integer(value: number): MojoTargetGenericArgument {
  return Object.freeze({ kind: "integer", value: String(value) });
}
