import {
  pointerFactKey,
  rawPointerFactKey,
  sourceMarkerFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type { Node, Type } from "@tsonic/tsts";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import { resolveMojoSourcePrimitive } from "./source-primitives.js";
import {
  namedType,
  typeSubjects,
  uniqueFact,
  uniqueFixedArrayFact,
} from "./resolution-helpers.js";
import {
  mojoSourceOriginTypeContract,
  resolveMojoSourceOrigin,
} from "./origins.js";
import { explicitLifecycle, implicitHeapLifecycle } from "./lifecycle-contracts.js";
import type { MojoTypeResolution, MojoTypeResolutionContext } from "./resolution.js";

export function resolveMojoRetainedType(
  selectedType: Type,
  authoredTypeNode: Node | undefined,
  context: MojoTypeResolutionContext,
  resolveNested: (selectedType: Type | undefined, authoredTypeNode: Node | undefined) => MojoTypeResolution,
): MojoTypeResolution | undefined {
  if (authoredTypeNode !== undefined) {
    const originContract = mojoSourceOriginTypeContract(selectedType, authoredTypeNode, context);
    if (originContract?.kind === "reference" || originContract?.kind === "mutable-reference") {
      const selectedValue = context.semantics.types.authoredType(originContract.valueTypeNode);
      const value = resolveNested(selectedValue, originContract.valueTypeNode);
      const origin = resolveMojoSourceOrigin(originContract.originTypeNode, context);
      return value.kind === "unsupported"
        ? value
        : origin === undefined
          ? { kind: "unsupported", reason: "the authored Mojo reference has no exact origin" }
          : {
              kind: "resolved",
              type: Object.freeze({
                kind: "reference",
                origin,
                mutable: originContract.kind === "mutable-reference",
                value: value.type,
              }),
            };
    }
    if (originContract !== undefined) {
      return {
        kind: "unsupported",
        reason: "a Mojo origin marker can appear only as an origin generic argument or constraint",
      };
    }
  }
  const subjects = typeSubjects(selectedType, authoredTypeNode, context);
  const sourceMarker = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, sourceMarkerFactKey)),
  );
  if (sourceMarker.kind === "conflict") {
    return { kind: "unsupported", reason: "selected source marker facts conflict" };
  }
  if (sourceMarker.value?.marker === "js-string") {
    return {
      kind: "resolved",
      type: namedType(
        "tsonic.mojo.js.JsString",
        ["tsonic_js"],
        "JsString",
        [],
        implicitHeapLifecycle,
      ),
    };
  }
  const rawPointer = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, rawPointerFactKey)),
  );
  if (rawPointer.kind === "conflict") {
    return { kind: "unsupported", reason: "selected raw-pointer facts conflict" };
  }
  if (rawPointer.value !== undefined) {
    return rawPointer.value.representation === "opaque-identity"
      ? {
          kind: "resolved",
          type: Object.freeze({
            kind: "target-named",
            id: "tsonic.mojo.runtime.RawPointer",
            modulePath: Object.freeze(["tsonic_runtime"]),
            name: "RawPointer",
            lifecycle: explicitLifecycle,
          }),
        }
      : { kind: "unsupported", reason: "selected raw-pointer representation is not opaque identity" };
  }
  const pointer = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, pointerFactKey)),
  );
  if (pointer.kind === "conflict") {
    return { kind: "unsupported", reason: "selected typed-location facts conflict" };
  }
  if (pointer.value !== undefined) {
    const selectedPointee = context.semantics.types.authoredType(pointer.value.pointee);
    const pointee = resolveNested(selectedPointee, pointer.value.pointee);
    return pointee.kind === "unsupported"
      ? pointee
      : {
          kind: "resolved",
          type: Object.freeze({
            kind: "target-named",
            id: "tsonic.mojo.runtime.Location",
            modulePath: Object.freeze(["tsonic_runtime"]),
            name: "Location",
            genericArguments: Object.freeze([Object.freeze({ kind: "type", type: pointee.type })]),
            lifecycle: implicitHeapLifecycle,
          }),
        };
  }
  const primitive = uniqueFact(
    subjects.map((subject) => context.sourceFacts.getFact(subject, sourcePrimitiveFactKey)),
  );
  if (primitive.kind === "conflict") {
    return { kind: "unsupported", reason: "selected source primitive facts conflict" };
  }
  if (primitive.value !== undefined) return resolveMojoSourcePrimitive(primitive.value);

  const fixedArray = uniqueFixedArrayFact(subjects.map((subject) =>
    context.sourceFacts.getFact(subject, tsonicFixedArrayFactKey)));
  if (fixedArray.kind === "conflict") {
    return { kind: "unsupported", reason: "selected fixed-array facts conflict" };
  }
  if (fixedArray.value === undefined) return undefined;
  const elementType = context.semantics.types.authoredType(fixedArray.value.elementType);
  const element = resolveNested(elementType, fixedArray.value.elementType);
  return element.kind === "unsupported"
    ? element
    : {
        kind: "resolved",
        type: Object.freeze({
          kind: "fixed-array",
          element: element.type,
          length: Object.freeze({ kind: "integer", value: String(fixedArray.value.length) }),
        }),
      };
}
