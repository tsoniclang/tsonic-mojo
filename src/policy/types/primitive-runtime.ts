import type { SourcePrimitiveKind } from "@tsonic/tsts";

export function mojoPrimitiveRuntimeCategory(kind: SourcePrimitiveKind): "boolean" | "string" | "number" | "bigint" {
  switch (kind) {
    case "bool": return "boolean";
    case "char": return "string";
    case "int64":
    case "uint64":
    case "int128":
    case "uint128": return "bigint";
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "native-int":
    case "native-uint":
    case "float16":
    case "float32":
    case "float64":
    case "decimal": return "number";
  }
}
