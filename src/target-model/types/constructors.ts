import type {
  SourcePrimitiveKind,
} from "@tsonic/tsts";
import type {
  MojoTargetCallableParameter,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "./model.js";
import type { MojoProjectTypeParameterDefinition } from "./project.js";

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

export function mojoGenericParameterReference(
  parameter: Pick<MojoProjectTypeParameterDefinition, "kind" | "name">,
): MojoTargetGenericArgument {
  switch (parameter.kind) {
    case "type":
      return Object.freeze({
        kind: "type",
        type: Object.freeze({ kind: "type-parameter", name: parameter.name }),
      });
    case "value":
      return Object.freeze({ kind: "value-reference", path: Object.freeze([parameter.name]) });
    case "origin":
      return Object.freeze({
        kind: "origin",
        origin: Object.freeze({ kind: "parameter", name: parameter.name }),
      });
  }
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
  domain: "native" | "js",
  raises: boolean,
): MojoTargetTypeRef {
  return Object.freeze({ kind: "future", domain, output, raises });
}

export function mojoOptionalTargetType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value });
}

export function mojoCallableTargetType(
  parameters: readonly MojoTargetCallableParameter[],
  result: MojoTargetTypeRef,
  raises = false,
  errorType?: MojoTargetTypeRef,
): MojoTargetTypeRef {
  return Object.freeze({
    kind: "callable",
    parameters: Object.freeze(parameters.map((parameter) => Object.freeze({
      ...parameter,
    }))),
    result,
    raises,
    ...(errorType === undefined ? {} : { errorType }),
  });
}

export function mojoUnionTargetType(members: readonly MojoTargetTypeRef[]): MojoTargetTypeRef {
  return Object.freeze({ kind: "union", members: Object.freeze([...members]) });
}
