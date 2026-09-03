import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

export function isJsArray(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray";
}

export function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isJsArray(type) || type.kind !== "target-named") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

export function boxNativeStringAsJsValue(
  expression: MojoExpression,
  context: MojoPlanningContext,
): MojoExpression {
  const jsStringType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.js.JsString",
    modulePath: Object.freeze(["tsonic_js"]),
    name: "JsString",
  });
  registerMojoTypeImports(jsStringType, context);
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_value_from_string"),
    arguments: Object.freeze([{ value: Object.freeze({
      kind: "construct",
      type: jsStringType,
      arguments: Object.freeze([{ value: expression }]),
    }) }]),
  });
}
