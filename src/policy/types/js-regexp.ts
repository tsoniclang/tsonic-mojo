import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { implicitHeapLifecycle } from "./lifecycle-contracts.js";
import { namedType } from "./resolution-helpers.js";

const owners = jsRegExpSourceProfileIdentity.owners;

const carrierByOwner = new Map<string, readonly [id: string, name: string]>([
  [owners.regExp, ["tsonic.mojo.js.JsRegExp", "JsRegExp"]],
  [owners.regExpExecArray, ["tsonic.mojo.js.RegExpExecArray", "RegExpExecArray"]],
  [owners.regExpIndicesArray, ["tsonic.mojo.js.RegExpIndicesArray", "RegExpIndicesArray"]],
  [owners.regExpMatchArray, ["tsonic.mojo.js.RegExpMatchArray", "RegExpMatchArray"]],
  [owners.regExpNamedGroups, ["tsonic.mojo.js.RegExpNamedGroups", "RegExpNamedGroups"]],
  [owners.regExpNamedIndices, ["tsonic.mojo.js.RegExpNamedIndices", "RegExpNamedIndices"]],
  [owners.regExpStringIterator, ["tsonic.mojo.js.RegExpStringIterator", "RegExpStringIterator"]],
  [owners.jsRegExpExecArray, ["tsonic.mojo.js.JsRegExpExecArray", "JsRegExpExecArray"]],
  [owners.jsRegExpIndicesArray, ["tsonic.mojo.js.JsRegExpIndicesArray", "JsRegExpIndicesArray"]],
  [owners.jsRegExpMatchArray, ["tsonic.mojo.js.JsRegExpMatchArray", "JsRegExpMatchArray"]],
  [owners.jsRegExpNamedGroups, ["tsonic.mojo.js.JsRegExpNamedGroups", "JsRegExpNamedGroups"]],
  [owners.jsRegExpNamedIndices, ["tsonic.mojo.js.JsRegExpNamedIndices", "JsRegExpNamedIndices"]],
  [owners.jsRegExpStringIterator, ["tsonic.mojo.js.JsRegExpStringIterator", "JsRegExpStringIterator"]],
]);

export function mojoJsRegExpTargetType(): MojoTargetTypeRef {
  return sourceProfileRegExpCarrier(owners.regExp)!;
}

export function mojoRegExpNativeResultType(
  value: MojoTargetTypeRef,
): MojoTargetTypeRef {
  return namedType(
    "tsonic.mojo.js.RegExpNativeResult",
    ["tsonic_js"],
    "RegExpNativeResult",
    [value],
    implicitHeapLifecycle,
  );
}

export function resolveMojoJsRegExpSourceProfileType(
  owner: string,
  sourceArguments: readonly MojoTargetTypeRef[],
): { readonly kind: "resolved"; readonly type: MojoTargetTypeRef } |
  { readonly kind: "unsupported"; readonly reason: string } | undefined {
  const carrier = sourceProfileRegExpCarrier(owner);
  if (carrier === undefined) return undefined;
  const iteratorElement = iteratorElementType(owner);
  if (iteratorElement === undefined) {
    return sourceArguments.length === 0
      ? { kind: "resolved", type: carrier }
      : {
          kind: "unsupported",
          reason: `selected JavaScript source-profile type '${owner}' has unexpected type arguments`,
        };
  }
  return sourceArguments.length === 1 &&
      mojoTargetTypeEquals(sourceArguments[0]!, iteratorElement)
    ? { kind: "resolved", type: carrier }
    : {
        kind: "unsupported",
        reason: `selected JavaScript source-profile iterator '${owner}' has no exact RegExp result element`,
      };
}

export function sourceProfileRegExpCarrier(
  owner: string,
): MojoTargetTypeRef | undefined {
  const selected = carrierByOwner.get(owner);
  return selected === undefined
    ? undefined
    : namedType(selected[0], ["tsonic_js"], selected[1], [], implicitHeapLifecycle);
}

export function sourceProfileRegExpElementType(
  receiver: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  if (receiver.kind !== "target-named") return undefined;
  switch (receiver.id) {
    case "tsonic.mojo.js.RegExpExecArray":
    case "tsonic.mojo.js.RegExpMatchArray":
      return Object.freeze({
        kind: "optional",
        value: Object.freeze({ kind: "native-string" }),
      });
    case "tsonic.mojo.js.JsRegExpExecArray":
    case "tsonic.mojo.js.JsRegExpMatchArray":
      return Object.freeze({
        kind: "optional",
        value: namedType(
          "tsonic.mojo.js.JsString",
          ["tsonic_js"],
          "JsString",
          [],
          implicitHeapLifecycle,
        ),
      });
    case "tsonic.mojo.js.RegExpIndicesArray":
    case "tsonic.mojo.js.JsRegExpIndicesArray":
      return Object.freeze({
        kind: "optional",
        value: Object.freeze({
          kind: "tuple",
          elements: Object.freeze([
            Object.freeze({ kind: "source-primitive", name: "float64" }),
            Object.freeze({ kind: "source-primitive", name: "float64" }),
          ]),
        }),
      });
    default:
      return undefined;
  }
}

export function sourceProfileRegExpNamedValueType(
  receiver: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  if (receiver.kind !== "target-named") return undefined;
  if (receiver.id === "tsonic.mojo.js.RegExpNamedGroups") {
    return Object.freeze({ kind: "optional", value: Object.freeze({ kind: "native-string" }) });
  }
  if (receiver.id === "tsonic.mojo.js.JsRegExpNamedGroups") {
    return Object.freeze({
      kind: "optional",
      value: namedType(
        "tsonic.mojo.js.JsString",
        ["tsonic_js"],
        "JsString",
        [],
        implicitHeapLifecycle,
      ),
    });
  }
  if (receiver.id === "tsonic.mojo.js.RegExpNamedIndices" ||
    receiver.id === "tsonic.mojo.js.JsRegExpNamedIndices") {
    return Object.freeze({
      kind: "optional",
      value: Object.freeze({
        kind: "tuple",
        elements: Object.freeze([
          Object.freeze({ kind: "source-primitive", name: "float64" }),
          Object.freeze({ kind: "source-primitive", name: "float64" }),
        ]),
      }),
    });
  }
  return undefined;
}

export function sourceProfileRegExpIteratorElement(
  receiver: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  if (receiver.kind !== "target-named") return undefined;
  if (receiver.id === "tsonic.mojo.js.RegExpStringIterator") {
    return sourceProfileRegExpCarrier(owners.regExpExecArray);
  }
  if (receiver.id === "tsonic.mojo.js.JsRegExpStringIterator") {
    return sourceProfileRegExpCarrier(owners.jsRegExpExecArray);
  }
  return undefined;
}

function iteratorElementType(owner: string): MojoTargetTypeRef | undefined {
  if (owner === owners.regExpStringIterator) {
    return sourceProfileRegExpCarrier(owners.regExpExecArray);
  }
  if (owner === owners.jsRegExpStringIterator) {
    return sourceProfileRegExpCarrier(owners.jsRegExpExecArray);
  }
  return undefined;
}
