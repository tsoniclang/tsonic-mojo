import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { classifyMojoValueRefinement } from "../refinements/value.js";
import { createMojoNarrowingView } from "./narrowing.js";
import type { MojoNarrowingCarrierResolver } from "./narrowing.js";
import type { MojoNullableReceiverView } from "./model.js";

export function createMojoNullableReceiverView(
  selectedType: MojoTargetTypeRef,
  physicalType: MojoTargetTypeRef,
  carriers: MojoNarrowingCarrierResolver,
): MojoNullableReceiverView | undefined {
  if (selectedType.kind === "optional") {
    if (physicalType.kind !== "optional" || !mojoTargetTypeEquals(selectedType, physicalType)) {
      throw new Error("An Optional expression lost its sealed Optional storage.");
    }
    const nested = createMojoNullableReceiverView(selectedType.value, physicalType.value, carriers);
    return Object.freeze({
      kind: "optional",
      carrier: carriers.carrierForType(physicalType),
      value: nested?.value ?? Object.freeze({
        carrier: carriers.carrierForType(physicalType.value), type: physicalType.value,
      }),
      ...(nested === undefined ? {} : { nested }),
    });
  }
  if (selectedType.kind !== "union") return undefined;
  const absent = selectedType.members.filter((member) =>
    member.kind === "null" || member.kind === "undefined");
  if (absent.length === 0) return undefined;
  const members = selectedType.members.filter((member) =>
    member.kind !== "null" && member.kind !== "undefined");
  if (members.length === 0) return undefined;
  const presentType: MojoTargetTypeRef = members.length === 1 ? members[0]!
    : Object.freeze({ kind: "union", members: Object.freeze(members) });
  const refinement = classifyMojoValueRefinement(physicalType, presentType);
  if (physicalType.kind !== "union" || refinement === undefined ||
    absent.some((type) => !physicalType.members.some((member) => mojoTargetTypeEquals(member, type)))) {
    throw new Error("A nullable union lost its exact physical present-value projection.");
  }
  const present = createMojoNarrowingView(refinement, carriers);
  const valueType = present.kind === "union-subset" ? physicalType : presentType;
  return Object.freeze({
    kind: "union",
    carrier: carriers.carrierForType(physicalType),
    absent: Object.freeze(absent.map((type) => Object.freeze({
      carrier: carriers.carrierForType(type), type,
    }))),
    present,
    value: Object.freeze({ carrier: carriers.carrierForType(valueType), type: valueType }),
  });
}
