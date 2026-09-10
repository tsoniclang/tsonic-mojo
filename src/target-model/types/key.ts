import type { MojoOriginRef } from "../origins/model.js";
import { mojoNativeErrorType } from "./error-carriers.js";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetCallableParameter,
  MojoTargetConstArgument,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "./model.js";

export function mojoTargetTypeKey(type: MojoTargetTypeRef): string {
  return JSON.stringify(typeIdentity(type));
}

function typeIdentity(type: MojoTargetTypeRef): readonly unknown[] {
  switch (type.kind) {
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "native-string":
    case "bigint":
    case "symbol": return [type.kind];
    case "source-primitive": return [type.kind, type.name];
    case "dynamic": return [type.kind, type.domain];
    case "type-parameter": return [type.kind, type.name, type.identity];
    case "target-named": return [type.kind, type.id, type.modulePath, type.name,
      (type.genericArguments ?? []).map(argumentIdentity)];
    case "list": return [type.kind, typeIdentity(type.element)];
    case "fixed-array": return [type.kind, typeIdentity(type.element), constIdentity(type.length)];
    case "dictionary": return [type.kind, typeIdentity(type.key), typeIdentity(type.value)];
    case "future": return [type.kind, type.domain, type.raises, typeIdentity(type.output)];
    case "optional": return [type.kind, typeIdentity(type.value)];
    case "union": return [type.kind, type.members.map(typeIdentity)];
    case "tuple": return [type.kind, type.elements.map(typeIdentity)];
    case "associated": return [type.kind, typeIdentity(type.owner), type.memberPath,
      type.genericArguments.map(argumentIdentity)];
    case "compiler-expression": return [type.kind, type.expression];
    case "reference": return [type.kind, type.mutable, originIdentity(type.origin), typeIdentity(type.value)];
    case "callable": return [type.kind,
      type.parameters.map((parameter) => parameterIdentity(parameter, false)),
      typeIdentity(type.result), type.raises,
      errorIdentity(type.raises, type.errorType)];
    case "function": return [type.kind, type.thin, type.asynchronous, type.capture,
      type.genericParameters.map(genericParameterIdentity),
      type.parameters.map((parameter) => parameterIdentity(parameter, true)),
      typeIdentity(type.result), type.raises,
      errorIdentity(type.raises, type.errorType)];
  }
}

function errorIdentity(raises: boolean, errorType: MojoTargetTypeRef | undefined): readonly unknown[] | undefined {
  return raises ? typeIdentity(errorType ?? mojoNativeErrorType())
    : errorType === undefined ? undefined : typeIdentity(errorType);
}

function parameterIdentity(parameter: MojoTargetCallableParameter, named: boolean): readonly unknown[] {
  return named
    ? [parameter.name, parameter.convention, parameter.passing, typeIdentity(parameter.type)]
    : [parameter.convention, parameter.passing, parameter.omissionKind ?? "required", typeIdentity(parameter.type)];
}

function genericParameterIdentity(parameter: MojoProviderTargetGenericParameter): readonly unknown[] {
  return [parameter.kind, parameter.name, parameter.position, parameter.variadic,
    parameter.constraints.map(typeIdentity),
    parameter.defaultArgument === undefined ? undefined : argumentIdentity(parameter.defaultArgument)];
}

function constIdentity(argument: MojoTargetConstArgument): readonly unknown[] {
  return [argument.kind, argument.kind === "parameter" ? argument.name : argument.value];
}

function argumentIdentity(argument: MojoTargetGenericArgument): readonly unknown[] {
  switch (argument.kind) {
    case "type": return [argument.kind, argument.name, typeIdentity(argument.type)];
    case "type-expression":
    case "compiler-expression": return [argument.kind, argument.name, argument.expression];
    case "static-string":
    case "integer":
    case "boolean": return [argument.kind, argument.name, argument.value];
    case "value-reference": return [argument.kind, argument.name, argument.path];
    case "origin": return [argument.kind, argument.name, originIdentity(argument.origin)];
    case "unbound": return [argument.kind, argument.name];
  }
}

function originIdentity(origin: MojoOriginRef): readonly unknown[] {
  switch (origin.kind) {
    case "static":
    case "comptime":
    case "inferred": return [origin.kind];
    case "untracked":
    case "unsafe": return [origin.kind, origin.mutable];
    case "parameter": return [origin.kind, origin.name];
    case "provider-expression": return [origin.kind, origin.tokens.map((token) => [token.kind, token.text])];
  }
}
