import type { Node } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export interface MojoArrayLiteralValueSelection {
  readonly kind: "value";
  readonly sourceElement: Node;
  readonly expression: Node;
  readonly targetType: MojoTargetTypeRef;
}

export interface MojoArrayLiteralFixedSpreadValue {
  readonly index: number;
  readonly sourceType: MojoTargetTypeRef;
  readonly targetType: MojoTargetTypeRef;
  readonly conversion: MojoValueConversion;
  readonly copy: boolean;
}

export interface MojoArrayLiteralFixedSpreadSelection {
  readonly kind: "fixed-spread";
  readonly sourceElement: Node;
  readonly expression: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly sourceOwnership: import("../../target-model/lifecycle/model.js").MojoValueOwnership;
  readonly values: readonly MojoArrayLiteralFixedSpreadValue[];
}

export interface MojoArrayLiteralSequenceSpreadSelection {
  readonly kind: "sequence-spread";
  readonly sourceElement: Node;
  readonly expression: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly sourceElementType: MojoTargetTypeRef;
  readonly targetType: MojoTargetTypeRef;
  readonly conversion: MojoValueConversion;
  readonly copy: boolean;
  readonly iteration: "native" | "js-array";
}

export type MojoArrayLiteralContribution =
  | MojoArrayLiteralValueSelection
  | MojoArrayLiteralFixedSpreadSelection
  | MojoArrayLiteralSequenceSpreadSelection;

export interface MojoArrayLiteralSelection {
  readonly expression: Node;
  readonly resultType: MojoTargetTypeRef;
  readonly contributions: readonly MojoArrayLiteralContribution[];
}
