import type {
  MojoProviderTargetGenericParameter,
  MojoTargetConstArgument,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "./model.js";

export function mojoTargetTypeEquals(
  left: MojoTargetTypeRef,
  right: MojoTargetTypeRef,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "source-primitive":
      return right.kind === "source-primitive" && left.name === right.name;
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "bigint":
    case "symbol":
      return true;
    case "dynamic":
      return right.kind === "dynamic" && left.domain === right.domain;
    case "type-parameter":
      return right.kind === "type-parameter" && left.name === right.name;
    case "target-named":
      return right.kind === "target-named" && left.id === right.id &&
        left.name === right.name &&
        arrayEquals(left.modulePath, right.modulePath, (a, b) => a === b) &&
        genericArgumentsEqual(left.genericArguments ?? [], right.genericArguments ?? []);
    case "list":
      return right.kind === "list" && mojoTargetTypeEquals(left.element, right.element);
    case "fixed-array":
      return right.kind === "fixed-array" &&
        mojoTargetTypeEquals(left.element, right.element) &&
        constArgumentsEqual(left.length, right.length);
    case "dictionary":
      return right.kind === "dictionary" &&
        mojoTargetTypeEquals(left.key, right.key) &&
        mojoTargetTypeEquals(left.value, right.value);
    case "future":
      return right.kind === "future" && left.domain === right.domain &&
        left.raises === right.raises &&
        mojoTargetTypeEquals(left.output, right.output);
    case "optional":
      return right.kind === "optional" && mojoTargetTypeEquals(left.value, right.value);
    case "union":
      return right.kind === "union" &&
        arrayEquals(left.members, right.members, mojoTargetTypeEquals);
    case "tuple":
      return right.kind === "tuple" &&
        arrayEquals(left.elements, right.elements, mojoTargetTypeEquals);
    case "associated":
      return right.kind === "associated" &&
        mojoTargetTypeEquals(left.owner, right.owner) &&
        arrayEquals(left.memberPath, right.memberPath, (a, b) => a === b) &&
        genericArgumentsEqual(left.genericArguments, right.genericArguments);
    case "compiler-expression":
      return right.kind === "compiler-expression" && left.expression === right.expression;
    case "reference":
      return right.kind === "reference" && left.origin === right.origin &&
        mojoTargetTypeEquals(left.value, right.value);
    case "callable":
      return right.kind === "callable" && left.raises === right.raises &&
        arrayEquals(left.parameters, right.parameters, (parameter, other) =>
          parameter.convention === other.convention &&
          parameter.passing === other.passing &&
          (parameter.omissionKind ?? "required") === (other.omissionKind ?? "required") &&
          mojoTargetTypeEquals(parameter.type, other.type)) &&
        mojoTargetTypeEquals(left.result, right.result);
    case "function":
      return right.kind === "function" && left.thin === right.thin &&
        left.asynchronous === right.asynchronous && left.raises === right.raises &&
        left.capture === right.capture &&
        arrayEquals(left.genericParameters, right.genericParameters, genericParametersEqual) &&
        arrayEquals(left.parameters, right.parameters, (parameter, other) =>
          parameter.name === other.name && parameter.convention === other.convention &&
          parameter.passing === other.passing &&
          mojoTargetTypeEquals(parameter.type, other.type)) &&
        mojoTargetTypeEquals(left.result, right.result) &&
        (left.errorType === undefined
          ? right.errorType === undefined
          : right.errorType !== undefined && mojoTargetTypeEquals(left.errorType, right.errorType));
  }
}

function genericParametersEqual(
  left: MojoProviderTargetGenericParameter,
  right: MojoProviderTargetGenericParameter,
): boolean {
  return left.kind === right.kind && left.name === right.name &&
    left.position === right.position && left.variadic === right.variadic &&
    arrayEquals(left.constraints, right.constraints, mojoTargetTypeEquals) &&
    genericArgumentsEqual(
      left.defaultArgument === undefined ? [] : [left.defaultArgument],
      right.defaultArgument === undefined ? [] : [right.defaultArgument],
    );
}

function genericArgumentsEqual(
  left: readonly MojoTargetGenericArgument[],
  right: readonly MojoTargetGenericArgument[],
): boolean {
  return left.length === right.length && left.every((argument, index) => {
    const other = right[index];
    if (other === undefined || argument.kind !== other.kind || argument.name !== other.name) {
      return false;
    }
    switch (argument.kind) {
      case "type":
        return other.kind === "type" && mojoTargetTypeEquals(argument.type, other.type);
      case "type-expression":
      case "compiler-expression":
        return other.kind === argument.kind && argument.expression === other.expression;
      case "static-string":
      case "integer":
      case "boolean":
        return other.kind === argument.kind && argument.value === other.value;
      case "value-reference":
        return other.kind === "value-reference" &&
          arrayEquals(argument.path, other.path, (left, right) => left === right);
      case "unbound":
        return true;
    }
  });
}

function constArgumentsEqual(
  left: MojoTargetConstArgument,
  right: MojoTargetConstArgument,
): boolean {
  return left.kind === right.kind && (left.kind === "integer"
    ? right.kind === "integer" && left.value === right.value
    : left.kind === "boolean"
      ? right.kind === "boolean" && left.value === right.value
      : right.kind === "parameter" && left.name === right.name);
}

function arrayEquals<T>(
  left: readonly T[],
  right: readonly T[],
  equals: (left: T, right: T) => boolean,
): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return other !== undefined && equals(value, other);
  });
}
