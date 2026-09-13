import type { MojoTruthinessConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { isJsString } from "./javascript-conversions.js";

export function classifyTruthiness(type: MojoTargetTypeRef): MojoTruthinessConversion | undefined {
  if (type.kind === "null" || type.kind === "undefined" || type.kind === "unit") {
    return Object.freeze({ kind: "always-false" });
  }
  if (type.kind === "native-string") return Object.freeze({ kind: "native-string" });
  if (isJsString(type)) return Object.freeze({ kind: "string" });
  if (type.kind === "dynamic" && type.domain === "js") {
    return Object.freeze({ kind: "dynamic" });
  }
  if (type.kind === "source-primitive") {
    if (type.name === "bool") return Object.freeze({ kind: "boolean" });
    if (type.name === "float32" || type.name === "float64") {
      return Object.freeze({ kind: "float" });
    }
    if (type.name === "char") return Object.freeze({ kind: "always-true" });
    return Object.freeze({ kind: "integer" });
  }
  if (type.kind === "bigint") return Object.freeze({ kind: "integer" });
  if (type.kind === "optional") {
    const value = classifyTruthiness(type.value);
    return value === undefined
      ? undefined
      : Object.freeze({ kind: "optional", sourceType: type, value });
  }
  if (type.kind === "union") {
    const members = type.members.map((member) => {
      const conversion = classifyTruthiness(member);
      return conversion === undefined ? undefined : Object.freeze({ type: member, conversion });
    });
    return members.some((member) => member === undefined)
      ? undefined
      : Object.freeze({
          kind: "union",
          sourceType: type,
          members: Object.freeze(members as readonly {
            readonly type: MojoTargetTypeRef;
            readonly conversion: MojoTruthinessConversion;
          }[]),
        });
  }
  if (type.kind === "never") return Object.freeze({ kind: "always-false" });
  if (type.kind === "type-parameter" || type.kind === "associated" ||
    type.kind === "compiler-expression" || type.kind === "symbol") return undefined;
  return Object.freeze({ kind: "always-true" });
}
