import type { MojoTargetTypeRef } from "../../../target-model/provider/model.js";
import type { MojoPlanningContext } from "../context.js";

export function registerMojoTypeImports(type: MojoTargetTypeRef, context: MojoPlanningContext): void {
  switch (type.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "type-parameter":
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
      for (const parameter of type.parameters) registerMojoTypeImports(parameter, context);
      registerMojoTypeImports(type.result, context);
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
    case "reference": return `ref[${type.origin}] ${requiredTypeName(type.value)}`;
    case "function": {
      const parameters = type.parameters.map(requiredTypeName).join(", ");
      const result = requiredTypeName(type.result);
      return `def(${parameters})${type.thin ? " thin" : ""}${type.raises ? " raises" : ""} -> ${result}`;
    }
  }
}

function renderGenericArgument(
  argument: NonNullable<Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>['genericArguments']>[number],
): string {
  const value = argument.kind === "type"
    ? requiredTypeName(argument.type)
    : argument.kind === "value" || argument.kind === "type-expression"
      ? argument.expression
      : "_";
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

function requiredTypeName(type: MojoTargetTypeRef): string {
  const name = mojoTypeName(type);
  if (name === undefined) throw new Error("Mojo unit cannot appear in a value type position.");
  return name;
}
