import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../types/model.js";

export interface MojoNativeLayout {
  readonly type: MojoTargetTypeRef;
  readonly byteSize: number;
  readonly byteAlignment: number;
  readonly stride: number;
  readonly addressWidth: 32 | 64;
  readonly littleEndian: boolean;
  readonly fields: readonly { readonly name: string; readonly byteOffset: number; readonly layout: MojoNativeLayout }[];
  readonly element?: MojoNativeLayout;
}

interface MojoMemoryOperationBase {
  readonly kind: "native-memory";
  readonly resultType: MojoTargetTypeRef;
}

export type MojoMemoryOperationSelection = MojoMemoryOperationBase & (
  | { readonly operation: "observation"; readonly value: number }
  | { readonly operation: "keep-alive"; readonly expression: Node; readonly inputType: MojoTargetTypeRef }
  | { readonly operation: "reinterpret"; readonly expression: Node;
      readonly inputType: MojoTargetTypeRef; readonly layout: MojoNativeLayout }
  | { readonly operation: "to-raw"; readonly expression: Node;
      readonly inputType: MojoTargetTypeRef; readonly layout: MojoNativeLayout }
  | { readonly operation: "raw-to-address-integer" | "address-integer-to-raw";
      readonly expression: Node; readonly inputType: MojoTargetTypeRef; readonly addressWidth: 32 | 64 }
  | { readonly operation: "byte-offset"; readonly expression: Node; readonly inputType: MojoTargetTypeRef;
      readonly offset: Node; readonly offsetType: MojoTargetTypeRef; readonly signed: boolean; readonly addressWidth: 32 | 64 }
);
