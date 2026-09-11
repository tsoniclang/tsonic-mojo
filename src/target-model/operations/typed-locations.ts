import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../types/model.js";

export type MojoLocationOwnerIdentity = "project" | "project-polymorphic" | "structural" | "array" | "callable";

export type MojoAddressedStorage =
  | { readonly kind: "local"; readonly declaration: Node }
  | { readonly kind: "field"; readonly expression: Node; readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef; readonly identity: MojoLocationOwnerIdentity; readonly key: string }
  | { readonly kind: "element"; readonly expression: Node; readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef; readonly identity: MojoLocationOwnerIdentity;
      readonly index: Node; readonly indexType: MojoTargetTypeRef };

interface MojoTypedLocationBase {
  readonly kind: "typed-location";
  readonly pointeeType: MojoTargetTypeRef;
  readonly locationType: MojoTargetTypeRef;
  readonly resultType: MojoTargetTypeRef;
}

export type MojoTypedLocationSelection = MojoTypedLocationBase & (
  | { readonly operation: "address-of"; readonly storage: MojoAddressedStorage }
  | { readonly operation: "allocate"; readonly initialExpression: Node }
  | { readonly operation: "load"; readonly pointerExpression: Node }
  | { readonly operation: "store"; readonly pointerExpression: Node; readonly valueExpression: Node }
  | { readonly operation: "equal-pointer"; readonly operandType: MojoTargetTypeRef; readonly leftExpression: Node; readonly rightExpression: Node }
  | { readonly operation: "hash-pointer"; readonly operandType: MojoTargetTypeRef; readonly pointerExpression: Node }
  | { readonly operation: "bind-pointer"; readonly identityExpression: Node; readonly identityType: MojoTargetTypeRef; readonly identity: MojoLocationOwnerIdentity;
      readonly readExpression: Node; readonly readType: MojoTargetTypeRef; readonly writeExpression: Node; readonly writeType: MojoTargetTypeRef }
  | { readonly operation: "project-pointer"; readonly pointerExpression: Node; readonly sourceLocationType: MojoTargetTypeRef; readonly optional: boolean;
      readonly fromSourceExpression: Node; readonly fromSourceType: MojoTargetTypeRef; readonly toSourceExpression: Node; readonly toSourceType: MojoTargetTypeRef }
);
