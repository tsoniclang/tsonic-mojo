import type { MojoClosedIterationContract } from "../../target-model/operations/iterations.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import {
  sourceProfileRegExpElementType,
  sourceProfileRegExpIteratorElement,
} from "../types/js-regexp.js";

export function selectMojoClosedIteration(
  kind: "for-of" | "for-in",
  iterable: MojoTargetTypeRef,
): MojoClosedIterationContract | undefined {
  if (kind === "for-in") {
    return iterable.kind === "dictionary"
      ? Object.freeze({ target: "dictionary-keys", elementType: iterable.key })
      : undefined;
  }
  if (iterable.kind === "list" || iterable.kind === "fixed-array") {
    return Object.freeze({ target: "native-values", elementType: iterable.element });
  }
  const regexpElement = sourceProfileRegExpIteratorElement(iterable) ?? sourceProfileRegExpElementType(iterable);
  if (regexpElement !== undefined) {
    return Object.freeze({ target: "js-array-values", elementType: regexpElement });
  }
  if (iterable.kind !== "target-named") return undefined;
  if (iterable.id === "tsonic.mojo.js.JsString") {
    return Object.freeze({ target: "js-string-values", elementType: iterable });
  }
  const arguments_ = iterable.genericArguments;
  if (iterable.id === "tsonic.mojo.js.JsMap" && arguments_?.length === 2 &&
    arguments_[0]?.kind === "type" && arguments_[1]?.kind === "type") {
    return Object.freeze({
      target: "js-map-entries",
      elementType: Object.freeze({ kind: "tuple", elements: Object.freeze([arguments_[0].type, arguments_[1].type]) }),
    });
  }
  if (arguments_?.length !== 1 || arguments_[0]?.kind !== "type") return undefined;
  const target = valueIterationTargets.get(iterable.id);
  return target === undefined ? undefined : Object.freeze({ target, elementType: arguments_[0].type });
}

const valueIterationTargets = new Map<string, "native-values" | "js-array-live-values" | "js-set-values">([
  ["tsonic.mojo.js.JsIterator", "native-values"],
  ["tsonic.mojo.js.JsArray", "js-array-live-values"],
  ["tsonic.mojo.js.JsSet", "js-set-values"],
]);
