import type {
  SourcePrimitiveKind,
} from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "./model.js";
import type { MojoTargetGenericArgument } from "./model.js";

export function mojoPrimitiveTargetType(name: SourcePrimitiveKind): MojoTargetTypeRef {
  return Object.freeze({ kind: "source-primitive", name });
}

export function mojoStringTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "native-string" });
}

export function mojoUnitTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "unit" });
}

export function mojoNeverTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "never" });
}

export function mojoNullTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "null" });
}

export function mojoUndefinedTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "undefined" });
}

export function mojoDynamicTargetType(domain: "source" | "js"): MojoTargetTypeRef {
  return Object.freeze({ kind: "dynamic", domain });
}

export function mojoBigIntTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "bigint" });
}

export function mojoSymbolTargetType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "symbol" });
}

export function mojoNamedTargetType(
  id: string,
  modulePath: readonly string[],
  name: string,
  typeArguments?: readonly MojoTargetTypeRef[],
): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id,
    modulePath: Object.freeze([...modulePath]),
    name,
    ...(typeArguments === undefined
      ? {}
      : {
          genericArguments: Object.freeze(typeArguments.map(
            (type): MojoTargetGenericArgument => Object.freeze({ kind: "type", type }),
          )),
        }),
  });
}

export function mojoListTargetType(element: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "list", element });
}

export function mojoFixedArrayTargetType(
  element: MojoTargetTypeRef,
  length: import("./model.js").MojoTargetConstArgument,
): MojoTargetTypeRef {
  return Object.freeze({ kind: "fixed-array", element, length });
}

export function mojoDictionaryTargetType(
  key: MojoTargetTypeRef,
  value: MojoTargetTypeRef,
): MojoTargetTypeRef {
  return Object.freeze({ kind: "dictionary", key, value });
}

export function mojoFutureTargetType(
  output: MojoTargetTypeRef,
  domain: "native" | "js" = "native",
): MojoTargetTypeRef {
  return Object.freeze({ kind: "future", domain, output });
}

export function mojoOptionalTargetType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value });
}

export function mojoUnionTargetType(members: readonly MojoTargetTypeRef[]): MojoTargetTypeRef {
  return Object.freeze({ kind: "union", members: Object.freeze([...members]) });
}
