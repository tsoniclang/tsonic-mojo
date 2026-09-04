import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";

export function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

export function isJsValue(type: MojoTargetTypeRef): boolean {
  return type.kind === "dynamic" && type.domain === "js";
}

function isJsArray(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray";
}

export function collectionShape(type: MojoTargetTypeRef): {
  readonly kind: "list" | "js-array";
  readonly element: MojoTargetTypeRef;
} | undefined {
  if (type.kind === "list") return Object.freeze({ kind: "list", element: type.element });
  const element = jsArrayElement(type);
  return element === undefined
    ? undefined
    : Object.freeze({ kind: "js-array", element });
}

function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isJsArray(type) || type.kind !== "target-named") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

export function jsValueBoxConversion(
  type: MojoTargetTypeRef,
  targetType: MojoTargetTypeRef,
): Extract<MojoValueConversion, { kind: "js-box" }> | undefined {
  if (type.kind === "source-primitive") {
    if (type.name === "bool") {
      return Object.freeze({ kind: "js-box", targetType, source: "bool" });
    }
    return type.name === "char" || type.name === "decimal"
      ? undefined
      : Object.freeze({ kind: "js-box", targetType, source: "number", sourceType: type });
  }
  const source = type.kind === "native-string"
    ? "native-string" as const
    : isJsString(type)
      ? "string" as const
      : type.kind === "symbol"
        ? "symbol" as const
        : type.kind === "null"
          ? "null" as const
          : type.kind === "undefined"
            ? "undefined" as const
            : undefined;
  return source === undefined
    ? undefined
    : Object.freeze({ kind: "js-box", targetType, source });
}

export function sameConversion(left: MojoValueConversion, right: MojoValueConversion): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

