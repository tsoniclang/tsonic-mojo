import {
  defineExtensionFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  Type,
} from "@tsonic/tsts";
import {
  mojoSourceSemanticsExtensionId,
} from "../identity.js";

export interface MojoSourceValueOperationFact {
  readonly kind: "copy" | "materialize";
  readonly expression: Node;
  readonly sourceType: Type;
  readonly resultType: Type;
}

export const mojoSourceValueOperationFactKey = defineExtensionFactKey<MojoSourceValueOperationFact>({
  extensionId: mojoSourceSemanticsExtensionId,
  name: "valueOperation",
  snapshot: (value) => Object.freeze({ ...value }),
  equals: (left, right) =>
    left.kind === right.kind &&
    left.expression === right.expression &&
    left.sourceType === right.sourceType &&
    left.resultType === right.resultType,
});
