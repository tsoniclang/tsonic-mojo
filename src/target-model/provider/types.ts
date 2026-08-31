import type { SourcePrimitiveKind } from "@tsonic/tsts";
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

export function mojoOptionalTargetType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value });
}
