import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoNativePointerTargetId } from "../../providers/builtins/source-types.js";

const cScalarKinds = new Set([
  "bool", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
  "native-int", "native-uint", "float32", "float64",
]);

export function isMojoCAbiValue(type: MojoTargetTypeRef): boolean {
  return type.kind === "source-primitive" && cScalarKinds.has(type.name) ||
    type.kind === "target-named" && type.id === mojoNativePointerTargetId;
}

export function mojoCVariadicPromotion(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isMojoCAbiValue(type)) return undefined;
  if (type.kind !== "source-primitive") return type;
  switch (type.name) {
    case "bool":
    case "int8":
    case "uint8":
    case "int16":
    case "uint16": return Object.freeze({ kind: "source-primitive", name: "int32" });
    case "float32": return Object.freeze({ kind: "source-primitive", name: "float64" });
    default: return type;
  }
}
