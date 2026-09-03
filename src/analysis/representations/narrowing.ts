import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueRefinementSelection } from "../refinements/model.js";
import type {
  MojoNarrowingAlternative,
  MojoNarrowingView,
  MojoPhysicalTypeId,
} from "./model.js";

export interface MojoNarrowingCarrierResolver {
  readonly carrierForType: (type: MojoTargetTypeRef) => MojoPhysicalTypeId;
}

export function createMojoNarrowingView(
  refinement: MojoValueRefinementSelection,
  carriers: MojoNarrowingCarrierResolver,
): MojoNarrowingView {
  const sourceCarrier = carriers.carrierForType(refinement.sourceType);
  if (refinement.kind === "optional-present") {
    return Object.freeze({
      kind: "optional-present",
      carrier: sourceCarrier,
      value: alternative(refinement.resultType, carriers),
    });
  }
  if (refinement.kind === "union-member") {
    return Object.freeze({
      kind: "union-member",
      carrier: sourceCarrier,
      member: alternative(refinement.resultType, carriers),
    });
  }
  return Object.freeze({
    kind: "union-subset",
    carrier: sourceCarrier,
    allowedAlternatives: Object.freeze(refinement.resultType.members.map((type) =>
      alternative(type, carriers))),
  });
}

function alternative(
  type: MojoTargetTypeRef,
  carriers: MojoNarrowingCarrierResolver,
): MojoNarrowingAlternative {
  return Object.freeze({ carrier: carriers.carrierForType(type), type });
}
