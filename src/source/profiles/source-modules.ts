import { sourcePrimitive } from "@tsonic/tsts";
import type { SourceSemanticsModule } from "@tsonic/tsts";
import {
  mojoLangModule,
  mojoTypesModule,
} from "../semantics/identity.js";

export { mojoLangModule, mojoTypesModule } from "../semantics/identity.js";

const mojoPrimitiveAliases = [
  sourcePrimitive("bool", "bool", "boolean"),
  sourcePrimitive("i8", "int8", "number", true, 8),
  sourcePrimitive("u8", "uint8", "number", false, 8),
  sourcePrimitive("i16", "int16", "number", true, 16),
  sourcePrimitive("u16", "uint16", "number", false, 16),
  sourcePrimitive("i32", "int32", "number", true, 32),
  sourcePrimitive("u32", "uint32", "number", false, 32),
  sourcePrimitive("i64", "int64", "bigint", true, 64),
  sourcePrimitive("u64", "uint64", "bigint", false, 64),
  sourcePrimitive("isize", "native-int", "number", true),
  sourcePrimitive("usize", "native-uint", "number", false),
  sourcePrimitive("f16", "float16", "number", true, 16),
  sourcePrimitive("f32", "float32", "number", true, 32),
  sourcePrimitive("f64", "float64", "number", true, 64),
] satisfies SourceSemanticsModule["exports"];

export function mojoSourceSemanticsModules(): readonly SourceSemanticsModule[] {
  return Object.freeze([
    Object.freeze({
      moduleSpecifier: mojoTypesModule,
      packageName: "@tsonic/mojo",
      subpath: "types.js",
      capabilities: Object.freeze(["primitive" as const]),
      exports: Object.freeze(mojoPrimitiveAliases),
    }),
    Object.freeze({
      moduleSpecifier: mojoLangModule,
      packageName: "@tsonic/mojo",
      subpath: "lang.js",
      exports: Object.freeze([]),
    }),
  ]);
}
