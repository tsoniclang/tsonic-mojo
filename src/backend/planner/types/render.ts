import type { MojoTargetTypeRef } from "../../../target-model/provider/model.js";
import type { MojoPlanningContext } from "../context.js";

export function registerMojoTypeImports(type: MojoTargetTypeRef, context: MojoPlanningContext): void {
  switch (type.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "type-parameter":
    case "compiler-expression":
      return;
    case "target-named":
      if (type.modulePath.length > 0) context.imports.add(type.modulePath.join("."));
      for (const argument of type.genericArguments ?? []) {
        if (argument.kind === "type") registerMojoTypeImports(argument.type, context);
      }
      return;
    case "list":
      context.imports.add("std.collections.List");
      registerMojoTypeImports(type.element, context);
      return;
    case "optional":
      context.imports.add("std.collections.Optional");
      registerMojoTypeImports(type.value, context);
      return;
    case "tuple":
      for (const element of type.elements) registerMojoTypeImports(element, context);
      return;
    case "associated":
      registerMojoTypeImports(type.owner, context);
      for (const argument of type.genericArguments) {
        if (argument.kind === "type") registerMojoTypeImports(argument.type, context);
      }
      return;
    case "reference":
      registerMojoTypeImports(type.value, context);
      return;
    case "function":
      for (const parameter of type.genericParameters) {
        for (const constraint of parameter.constraints) registerMojoTypeImports(constraint, context);
        if (parameter.defaultArgument?.kind === "type") {
          registerMojoTypeImports(parameter.defaultArgument.type, context);
        }
      }
      for (const parameter of type.parameters) registerMojoTypeImports(parameter.type, context);
      registerMojoTypeImports(type.result, context);
      if (type.errorType !== undefined) registerMojoTypeImports(type.errorType, context);
      return;
  }
}

export function mojoTypeName(type: MojoTargetTypeRef): string | undefined {
  switch (type.kind) {
    case "native-string": return "String";
    case "unit": return undefined;
    case "type-parameter": return type.name;
    case "source-primitive":
      switch (type.name) {
        case "bool": return "Bool";
        case "char": return "UInt16";
        case "int8": return "Int8";
        case "uint8": return "UInt8";
        case "int16": return "Int16";
        case "uint16": return "UInt16";
        case "int32": return "Int32";
        case "uint32": return "UInt32";
        case "int64": return "Int64";
        case "uint64": return "UInt64";
        case "native-int": return "Int";
        case "native-uint": return "UInt";
        case "float16": return "Float16";
        case "float32": return "Float32";
        case "float64": return "Float64";
        case "decimal":
        case "int128":
        case "uint128": return undefined;
      }
    case "target-named": {
      const base = [...type.modulePath, type.name].join(".");
      const arguments_ = type.genericArguments ?? [];
      return arguments_.length === 0
        ? base
        : `${base}[${arguments_.map(renderGenericArgument).join(", ")}]`;
    }
    case "list": return `List[${requiredTypeName(type.element)}]`;
    case "optional": return `Optional[${requiredTypeName(type.value)}]`;
    case "tuple": return `(${type.elements.map(requiredTypeName).join(", ")})`;
    case "associated": {
      const base = `${requiredTypeName(type.owner)}.${type.memberPath.join(".")}`;
      return type.genericArguments.length === 0
        ? base
        : `${base}[${type.genericArguments.map(renderGenericArgument).join(", ")}]`;
    }
    case "compiler-expression": return type.expression;
    case "reference": return `ref[${type.origin}] ${requiredTypeName(type.value)}`;
    case "function": {
      const generics = renderGenericParameters(type.genericParameters);
      const parameters = type.parameters.map(renderFunctionParameter).join(", ");
      const result = mojoTypeName(type.result) ?? "None";
      const capture = type.capture === undefined
        ? ""
        : type.capture === "*"
          ? " capturing"
          : ` capturing[${type.capture}]`;
      const error = type.errorType === undefined ? "" : ` ${requiredTypeName(type.errorType)}`;
      return `${type.asynchronous ? "async " : ""}def${generics}(${parameters})${
        type.thin ? " thin" : ""
      }${capture}${type.raises ? ` raises${error}` : ""} -> ${result}`;
    }
  }
}

function renderFunctionParameter(
  parameter: Extract<MojoTargetTypeRef, { readonly kind: "function" }>["parameters"][number],
): string {
  if (parameter.convention === "ref" && parameter.type.kind === "reference") {
    const prefix = `ref[${parameter.type.origin}]`;
    return parameter.name === undefined
      ? `${prefix} ${requiredTypeName(parameter.type.value)}`
      : `${prefix} ${parameter.name}: ${requiredTypeName(parameter.type.value)}`;
  }
  const convention = parameter.convention === "imm" ? "" : `${parameter.convention} `;
  return parameter.name === undefined
    ? `${convention}${requiredTypeName(parameter.type)}`
    : `${convention}${parameter.name}: ${requiredTypeName(parameter.type)}`;
}

function renderGenericParameters(
  parameters: readonly import("../../../target-model/provider/model.js").MojoProviderTargetGenericParameter[],
): string {
  if (parameters.length === 0) return "";
  const parts: string[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.position === "keyword" && parameters[index - 1]?.position !== "keyword") {
      parts.push("*");
    }
    const name = `${parameter.variadic ? "*" : ""}${parameter.name}`;
    const constraints = parameter.constraints.map(requiredTypeName).join(" & ");
    const defaultArgument = parameter.defaultArgument === undefined
      ? ""
      : ` = ${renderGenericArgument(parameter.defaultArgument)}`;
    parts.push(`${name}: ${constraints}${defaultArgument}`);
    const next = parameters[index + 1];
    if (parameter.position === "inferred" && next?.position !== "inferred") parts.push("//");
    else if (parameter.position === "positional" && next?.position !== "positional") parts.push("/");
  }
  return `[${parts.join(", ")}]`;
}

function renderGenericArgument(
  argument: NonNullable<Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>['genericArguments']>[number],
): string {
  const value = argument.kind === "type"
    ? requiredTypeName(argument.type)
    : argument.kind === "value" || argument.kind === "type-expression" || argument.kind === "compiler-expression"
      ? argument.expression
      : "_";
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

function requiredTypeName(type: MojoTargetTypeRef): string {
  const name = mojoTypeName(type);
  if (name === undefined) throw new Error("Mojo unit cannot appear in a value type position.");
  return name;
}
