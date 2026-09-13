import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { implicitHeapLifecycle } from "./lifecycle-contracts.js";
import { mojoNamedTargetType } from "../../target-model/types/constructors.js";

export function mojoIteratorResultMember(
  owner: string,
  argument: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  const name = owner === "IteratorYieldResult" ? "JsIteratorYield"
    : owner === "IteratorReturnResult" ? "JsIteratorReturn" : undefined;
  return name === undefined ? undefined : Object.freeze({
    ...mojoNamedTargetType(`tsonic.mojo.js.${name}`, ["tsonic_js"], name, [argument]),
    lifecycle: implicitHeapLifecycle,
  });
}

export function canonicalMojoIteratorResult(
  members: readonly MojoTargetTypeRef[],
): MojoTargetTypeRef | undefined {
  if (members.length !== 2) return undefined;
  const yielded = members.find((type) =>
    type.kind === "target-named" && type.id === "tsonic.mojo.js.JsIteratorYield");
  const returned = members.find((type) =>
    type.kind === "target-named" && type.id === "tsonic.mojo.js.JsIteratorReturn");
  return yielded === undefined || returned === undefined ? undefined : Object.freeze({
    kind: "union", members: Object.freeze([yielded, returned]),
  });
}

export function mojoIteratorResultProperty(
  receiver: MojoTargetTypeRef,
  member: string,
): MojoTargetTypeRef | undefined {
  if (receiver.kind !== "target-named") return undefined;
  const yielded = receiver.id === "tsonic.mojo.js.JsIteratorYield";
  if (!yielded && receiver.id !== "tsonic.mojo.js.JsIteratorReturn") return undefined;
  if (member === "value") {
    const argument = receiver.genericArguments?.[0];
    return argument?.kind === "type" ? argument.type : undefined;
  }
  if (member !== "done") return undefined;
  const boolean = Object.freeze({ kind: "source-primitive" as const, name: "bool" as const });
  return yielded ? Object.freeze({ kind: "optional", value: boolean }) : boolean;
}
