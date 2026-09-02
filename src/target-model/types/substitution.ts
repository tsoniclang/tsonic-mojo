import type {
  MojoProviderTargetGenericParameter,
  MojoTargetConstArgument,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "./model.js";

export interface MojoTargetTypeSubstitutions {
  readonly types: ReadonlyMap<string, MojoTargetTypeRef>;
  readonly values: ReadonlyMap<string, MojoTargetGenericArgument>;
  readonly packs: ReadonlyMap<string, readonly MojoTargetGenericArgument[]>;
}

export function substituteMojoTargetType(
  type: MojoTargetTypeRef,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTargetTypeRef {
  switch (type.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "dynamic":
    case "bigint":
    case "symbol":
    case "compiler-expression":
      return type;
    case "type-parameter":
      return substitutions.types.get(type.name) ?? type;
    case "target-named":
      return Object.freeze({
        ...type,
        ...(type.genericArguments === undefined
          ? {}
          : {
              genericArguments: Object.freeze(type.genericArguments.flatMap((argument) =>
                substituteGenericArguments(argument, substitutions))),
            }),
      });
    case "list":
      return Object.freeze({
        kind: "list",
        element: substituteMojoTargetType(type.element, substitutions),
      });
    case "fixed-array":
      return Object.freeze({
        kind: "fixed-array",
        element: substituteMojoTargetType(type.element, substitutions),
        length: substituteConstArgument(type.length, substitutions),
      });
    case "dictionary":
      return Object.freeze({
        kind: "dictionary",
        key: substituteMojoTargetType(type.key, substitutions),
        value: substituteMojoTargetType(type.value, substitutions),
      });
    case "future":
      return Object.freeze({
        kind: "future",
        domain: type.domain,
        raises: type.raises,
        output: substituteMojoTargetType(type.output, substitutions),
      });
    case "optional":
      return Object.freeze({
        kind: "optional",
        value: substituteMojoTargetType(type.value, substitutions),
      });
    case "union":
      return Object.freeze({
        kind: "union",
        members: Object.freeze(type.members.map((member) =>
          substituteMojoTargetType(member, substitutions))),
      });
    case "tuple":
      return Object.freeze({
        kind: "tuple",
        elements: Object.freeze(type.elements.map((element) =>
          substituteMojoTargetType(element, substitutions))),
      });
    case "associated":
      return Object.freeze({
        kind: "associated",
        owner: substituteMojoTargetType(type.owner, substitutions),
        memberPath: type.memberPath,
        genericArguments: Object.freeze(type.genericArguments.flatMap((argument) =>
          substituteGenericArguments(argument, substitutions))),
      });
    case "reference":
      return Object.freeze({
        kind: "reference",
        origin: type.origin,
        value: substituteMojoTargetType(type.value, substitutions),
      });
    case "callable":
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) => Object.freeze({
          ...parameter,
          type: substituteMojoTargetType(parameter.type, substitutions),
        }))),
        result: substituteMojoTargetType(type.result, substitutions),
        ...(type.errorType === undefined
          ? {}
          : { errorType: substituteMojoTargetType(type.errorType, substitutions) }),
      });
    case "function": {
      const nestedTypes = new Map(substitutions.types);
      const nestedValues = new Map(substitutions.values);
      const nestedPacks = new Map(substitutions.packs);
      for (const parameter of type.genericParameters) {
        if (parameter.kind === "type") nestedTypes.delete(parameter.name);
        else nestedValues.delete(parameter.name);
        nestedPacks.delete(parameter.name);
      }
      const nested = { types: nestedTypes, values: nestedValues, packs: nestedPacks };
      return Object.freeze({
        ...type,
        genericParameters: Object.freeze(type.genericParameters.map((parameter) =>
          substituteGenericParameter(parameter, nested))),
        parameters: Object.freeze(type.parameters.map((parameter) => Object.freeze({
          ...parameter,
          type: substituteMojoTargetType(parameter.type, nested),
        }))),
        result: substituteMojoTargetType(type.result, nested),
        ...(type.errorType === undefined
          ? {}
          : { errorType: substituteMojoTargetType(type.errorType, nested) }),
      });
    }
  }
}

function substituteGenericParameter(
  parameter: MojoProviderTargetGenericParameter,
  substitutions: MojoTargetTypeSubstitutions,
): MojoProviderTargetGenericParameter {
  return Object.freeze({
    ...parameter,
    constraints: Object.freeze(parameter.constraints.map((constraint) =>
      substituteMojoTargetType(constraint, substitutions))),
    ...(parameter.defaultArgument === undefined
      ? {}
      : { defaultArgument: substituteSingleGenericArgument(parameter.defaultArgument, substitutions) }),
  });
}

function substituteGenericArguments(
  argument: MojoTargetGenericArgument,
  substitutions: MojoTargetTypeSubstitutions,
): readonly MojoTargetGenericArgument[] {
  if (argument.kind === "type" && argument.type.kind === "type-parameter") {
    const replacement = substitutions.packs.get(argument.type.name);
    if (replacement !== undefined) return replacement;
  }
  if (argument.kind === "value-reference" && argument.path.length === 1) {
    const replacement = substitutions.packs.get(argument.path[0]!);
    if (replacement !== undefined) return replacement;
  }
  if (argument.kind === "type") {
    return Object.freeze([Object.freeze({
      ...argument,
      type: substituteMojoTargetType(argument.type, substitutions),
    })]);
  }
  if (argument.kind === "value-reference" && argument.path.length === 1) {
    const replacement = substitutions.values.get(argument.path[0]!);
    if (replacement !== undefined) {
      return Object.freeze([argument.name === undefined
        ? replacement
        : Object.freeze({ ...replacement, name: argument.name })]);
    }
  }
  return Object.freeze([argument]);
}

function substituteSingleGenericArgument(
  argument: MojoTargetGenericArgument,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTargetGenericArgument {
  const values = substituteGenericArguments(argument, substitutions);
  return values.length === 1 ? values[0]! : argument;
}

function substituteConstArgument(
  argument: MojoTargetConstArgument,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTargetConstArgument {
  return argument.kind === "parameter"
    ? constArgumentForGenericValue(substitutions.values.get(argument.name)) ?? argument
    : argument;
}

function constArgumentForGenericValue(
  argument: MojoTargetGenericArgument | undefined,
): MojoTargetConstArgument | undefined {
  if (argument?.kind === "integer") return Object.freeze({ kind: "integer", value: argument.value });
  if (argument?.kind === "boolean") return Object.freeze({ kind: "boolean", value: argument.value });
  if (argument?.kind === "value-reference" && argument.path.length === 1) {
    return Object.freeze({ kind: "parameter", name: argument.path[0]! });
  }
  return undefined;
}
