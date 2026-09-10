import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import { mojoNativeErrorType } from "../../../../target-model/types/error-domains.js";
import type { MojoExpression, MojoStatement } from "../../../target-ast/index.js";

export const jsValueType = Object.freeze({ kind: "dynamic" as const, domain: "js" as const });
export const intType = Object.freeze({ kind: "target-named" as const, id: "mojo.builtin.Int", modulePath: Object.freeze([]), name: "Int" });
export const boolType = Object.freeze({ kind: "source-primitive" as const, name: "bool" as const });
export const stringType = Object.freeze({ kind: "native-string" as const });
export const jsStringType = named("tsonic_js", "tsonic.mojo.js.JsString", "JsString");
export const erasedContextType = named("tsonic_runtime", "tsonic.mojo.runtime.ErasedCallableContext", "ErasedCallableContext");

export function named(module: string, id: string, name: string): MojoTargetTypeRef {
  return Object.freeze({ kind: "target-named", id, modulePath: Object.freeze([module]), name });
}

export function path(name: string): MojoExpression {
  return Object.freeze({ kind: "path", path: name });
}

export function member(receiver: MojoExpression, name: string): MojoExpression {
  return Object.freeze({ kind: "member", receiver, name });
}

export function method(receiver: MojoExpression, name: string, values: readonly MojoExpression[] = []): MojoExpression {
  return Object.freeze({ kind: "method-call", receiver, name,
    arguments: Object.freeze(values.map((value) => Object.freeze({ value }))) });
}

export function call(callee: MojoExpression, values: readonly MojoExpression[] = []): MojoExpression {
  return Object.freeze({ kind: "call", callee,
    arguments: Object.freeze(values.map((value) => Object.freeze({ value }))) });
}

export function construct(type: MojoTargetTypeRef, values: readonly MojoExpression[] = []): MojoExpression {
  return Object.freeze({ kind: "construct", type,
    arguments: Object.freeze(values.map((value) => Object.freeze({ value }))) });
}

export function element(receiver: MojoExpression, index: number): MojoExpression {
  return Object.freeze({ kind: "element", receiver, index: number(index) });
}

export function number(value: number): MojoExpression {
  return Object.freeze({ kind: "number-literal", text: String(value) });
}

export function returned(expression: MojoExpression): MojoStatement {
  return Object.freeze({ kind: "return", expression });
}

export function tupleType(elements: readonly MojoTargetTypeRef[]): MojoTargetTypeRef {
  return Object.freeze({ kind: "tuple", elements: Object.freeze([...elements]) });
}

export function callableType(parameters: readonly MojoTargetTypeRef[], result: MojoTargetTypeRef, raises = false): MojoTargetTypeRef {
  return Object.freeze({ kind: "callable", parameters: Object.freeze(parameters.map((type) => Object.freeze({
    convention: "var" as const, passing: "consume" as const, type,
  }))), result, raises, ...(raises ? { errorType: mojoNativeErrorType() } : {}) });
}
