import type { SourcePrimitiveFact } from "@tsonic/tsts";
import type { MojoTypeResolution } from "./resolution.js";

export function resolveMojoSourcePrimitive(
  fact: SourcePrimitiveFact,
): MojoTypeResolution {
  switch (fact.kind) {
    case "bool":
    case "char":
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "int64":
    case "uint64":
    case "native-int":
    case "native-uint":
    case "float16":
    case "float32":
    case "float64":
    case "int128":
    case "uint128":
      return { kind: "resolved", type: { kind: "source-primitive", name: fact.kind } };
    case "decimal":
      return {
        kind: "unsupported",
        reason: "Mojo has no certified decimal source-primitive carrier",
      };
  }
}
