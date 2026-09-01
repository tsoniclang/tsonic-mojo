import type {
  MojoProviderTargetGenericParameter,
  MojoTargetConstArgument,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "./model.js";

export interface MojoTargetTypeSubstitutions {
  readonly types: ReadonlyMap<string, MojoTargetTypeRef>;
  readonly constants: ReadonlyMap<string, MojoTargetConstArgument>;
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
              genericArguments: Object.freeze(type.genericArguments.map((argument) =>
                substituteGenericArgument(argument, substitutions))),
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
        genericArguments: Object.freeze(type.genericArguments.map((argument) =>
          substituteGenericArgument(argument, substitutions))),
      });
    case "reference":
      return Object.freeze({
        kind: "reference",
        origin: type.origin,
        value: substituteMojoTargetType(type.value, substitutions),
      });
    case "function": {
      const nestedTypes = new Map(substitutions.types);
      const nestedConstants = new Map(substitutions.constants);
      for (const parameter of type.genericParameters) {
        if (parameter.kind === "type") nestedTypes.delete(parameter.name);
        else nestedConstants.delete(parameter.name);
      }
      const nested = { types: nestedTypes, constants: nestedConstants };
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
      : { defaultArgument: substituteGenericArgument(parameter.defaultArgument, substitutions) }),
  });
}

function substituteGenericArgument(
  argument: MojoTargetGenericArgument,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTargetGenericArgument {
  if (argument.kind === "type") {
    return Object.freeze({
      ...argument,
      type: substituteMojoTargetType(argument.type, substitutions),
    });
  }
  if (argument.kind === "value-reference" && argument.path.length === 1) {
    const replacement = substitutions.constants.get(argument.path[0]!);
    if (replacement !== undefined) {
      return genericArgumentForConstant(replacement, argument.name);
    }
  }
  return argument;
}

function substituteConstArgument(
  argument: MojoTargetConstArgument,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTargetConstArgument {
  return argument.kind === "parameter"
    ? substitutions.constants.get(argument.name) ?? argument
    : argument;
}

function genericArgumentForConstant(
  argument: MojoTargetConstArgument,
  name: string | undefined,
): MojoTargetGenericArgument {
  const named = name === undefined ? {} : { name };
  switch (argument.kind) {
    case "integer": return Object.freeze({ kind: "integer", ...named, value: argument.value });
    case "boolean": return Object.freeze({ kind: "boolean", ...named, value: argument.value });
    case "parameter": return Object.freeze({
      kind: "value-reference",
      ...named,
      path: Object.freeze([argument.name]),
    });
  }
}
