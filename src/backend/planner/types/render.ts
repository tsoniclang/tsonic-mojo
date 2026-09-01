import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoModuleImport, registerMojoSymbolImport } from "../program/context.js";

export function registerMojoTypeImports(type: MojoTargetTypeRef, context: MojoPlanningContext): void {
  switch (type.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "never":
    case "type-parameter":
    case "compiler-expression":
      return;
    case "null":
    case "undefined":
    case "bigint":
      registerMojoModuleImport(context, ["tsonic_runtime"]);
      return;
    case "dynamic":
      registerMojoModuleImport(context, [type.domain === "js" ? "tsonic_js" : "tsonic_runtime"]);
      return;
    case "symbol":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return;
    case "target-named":
      registerMojoModuleImport(context, type.modulePath);
      for (const argument of type.genericArguments ?? []) {
        if (argument.kind === "type") registerMojoTypeImports(argument.type, context);
      }
      return;
    case "list":
      registerMojoSymbolImport(context, ["std", "collections"], "List");
      registerMojoTypeImports(type.element, context);
      return;
    case "fixed-array":
      registerMojoTypeImports(type.element, context);
      return;
    case "dictionary":
      registerMojoSymbolImport(context, ["std", "collections"], "Dict");
      registerMojoTypeImports(type.key, context);
      registerMojoTypeImports(type.value, context);
      return;
    case "future":
      if (type.domain === "js") registerMojoModuleImport(context, ["tsonic_js"]);
      registerMojoTypeImports(type.output, context);
      return;
    case "optional":
      registerMojoSymbolImport(context, ["std", "collections"], "Optional");
      registerMojoTypeImports(type.value, context);
      return;
    case "union":
      registerMojoSymbolImport(context, ["std", "utils"], "Variant");
      for (const member of type.members) registerMojoTypeImports(member, context);
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
    case "callable":
      registerMojoModuleImport(context, ["tsonic_runtime"]);
      for (const parameter of type.parameters) registerMojoTypeImports(parameter.type, context);
      registerMojoTypeImports(type.result, context);
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

export function mojoTypeName(
  type: MojoTargetTypeRef,
  currentModulePath: readonly string[] = Object.freeze([]),
): string | undefined {
  switch (type.kind) {
    case "native-string": return "String";
    case "unit": return undefined;
    case "never": return "Never";
    case "null": return "tsonic_runtime.Null";
    case "undefined": return "tsonic_runtime.Undefined";
    case "dynamic": return type.domain === "js" ? "tsonic_js.JsValue" : "tsonic_runtime.TsValue";
    case "bigint": return "tsonic_runtime.BigInt";
    case "symbol": return "tsonic_js.JsSymbol";
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
        case "int128": return "Int128";
        case "uint128": return "UInt128";
        case "decimal": return undefined;
      }
    case "target-named": {
      const base = sameModulePath(type.modulePath, currentModulePath)
        ? type.name
        : [...type.modulePath, type.name].join(".");
      const arguments_ = type.genericArguments ?? [];
      return arguments_.length === 0
        ? base
        : `${base}[${arguments_.map((argument) => renderGenericArgument(argument, currentModulePath)).join(", ")}]`;
    }
    case "list": return `List[${requiredTypeName(type.element, currentModulePath)}]`;
    case "fixed-array": return `Array[${requiredTypeName(type.element, currentModulePath)}, ${renderConstArgument(type.length)}]`;
    case "dictionary": return `Dict[${requiredTypeName(type.key, currentModulePath)}, ${requiredTypeName(type.value, currentModulePath)}]`;
    case "future": return type.domain === "js"
      ? `tsonic_js.JsPromise[${requiredTypeName(type.output, currentModulePath)}]`
      : `${type.raises ? "RaisingCoroutine" : "Coroutine"}[${requiredTypeName(type.output, currentModulePath)}, ...]`;
    case "optional": return `Optional[${requiredTypeName(type.value, currentModulePath)}]`;
    case "union": return `Variant[${type.members.map((member) => requiredTypeName(member, currentModulePath)).join(", ")}]`;
    case "tuple": return `Tuple[${type.elements.map((element) => requiredTypeName(element, currentModulePath)).join(", ")}]`;
    case "associated": {
      const base = `${requiredTypeName(type.owner, currentModulePath)}.${type.memberPath.join(".")}`;
      return type.genericArguments.length === 0
        ? base
        : `${base}[${type.genericArguments.map((argument) => renderGenericArgument(argument, currentModulePath)).join(", ")}]`;
    }
    case "compiler-expression": return type.expression;
    case "reference": return `ref[${type.origin}] ${requiredTypeName(type.value, currentModulePath)}`;
    case "callable": {
      const argumentsType = `Tuple[${type.parameters.map((parameter) =>
        requiredTypeName(parameter.type, currentModulePath)).join(", ")}]`;
      const resultType = mojoTypeName(type.result, currentModulePath) ?? "NoneType";
      const name = type.raises ? "RaisingCallable" : "Callable";
      return `tsonic_runtime.${name}[${argumentsType}, ${resultType}]`;
    }
    case "function": {
      const generics = mojoGenericParametersText(type.genericParameters, currentModulePath);
      const parameters = type.parameters.map((parameter) =>
        renderFunctionParameter(parameter, currentModulePath)).join(", ");
      const result = mojoTypeName(type.result, currentModulePath) ?? "None";
      const capture = type.capture === undefined
        ? ""
        : type.capture === "*"
          ? " capturing"
          : ` capturing[${type.capture}]`;
      const error = type.errorType === undefined ? "" : ` ${requiredTypeName(type.errorType, currentModulePath)}`;
      return `${type.asynchronous ? "async " : ""}def${generics}(${parameters})${
        type.thin ? " thin" : ""
      }${capture}${type.raises ? ` raises${error}` : ""} -> ${result}`;
    }
  }
}

function renderConstArgument(
  argument: import("../../../target-model/types/model.js").MojoTargetConstArgument,
): string {
  switch (argument.kind) {
    case "integer": return argument.value;
    case "boolean": return argument.value ? "True" : "False";
    case "parameter": return argument.name;
  }
}

function renderFunctionParameter(
  parameter: Extract<MojoTargetTypeRef, { readonly kind: "function" }>["parameters"][number],
  currentModulePath: readonly string[],
): string {
  if (parameter.convention === "ref" && parameter.type.kind === "reference") {
    const prefix = `ref[${parameter.type.origin}]`;
    return parameter.name === undefined
      ? `${prefix} ${requiredTypeName(parameter.type.value, currentModulePath)}`
      : `${prefix} ${parameter.name}: ${requiredTypeName(parameter.type.value, currentModulePath)}`;
  }
  const convention = parameter.convention === "imm" ? "" : `${parameter.convention} `;
  return parameter.name === undefined
    ? `${convention}${requiredTypeName(parameter.type, currentModulePath)}`
    : `${convention}${parameter.name}: ${requiredTypeName(parameter.type, currentModulePath)}`;
}

export function mojoGenericParametersText(
  parameters: readonly import("../../../target-model/types/model.js").MojoProviderTargetGenericParameter[],
  currentModulePath: readonly string[] = Object.freeze([]),
): string {
  if (parameters.length === 0) return "";
  const parts: string[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.position === "keyword" && parameters[index - 1]?.position !== "keyword") {
      parts.push("*");
    }
    const name = `${parameter.variadic ? "*" : ""}${parameter.name}`;
    const constraints = parameter.constraints.length === 0
      ? "AnyType"
      : parameter.constraints.map((constraint) => requiredTypeName(constraint, currentModulePath)).join(" & ");
    const defaultArgument = parameter.defaultArgument === undefined
      ? ""
      : ` = ${renderGenericArgument(parameter.defaultArgument, currentModulePath)}`;
    parts.push(`${name}: ${constraints}${defaultArgument}`);
    const next = parameters[index + 1];
    if (parameter.position === "inferred" && next?.position !== "inferred") parts.push("//");
    else if (parameter.position === "positional" && next?.position !== "positional") parts.push("/");
  }
  return `[${parts.join(", ")}]`;
}

function renderGenericArgument(
  argument: NonNullable<Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>['genericArguments']>[number],
  currentModulePath: readonly string[],
): string {
  const value = renderGenericArgumentValue(argument, currentModulePath);
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

export function renderGenericArgumentValue(
  argument: import("../../../target-model/types/model.js").MojoTargetGenericArgument,
  currentModulePath: readonly string[] = Object.freeze([]),
): string {
  switch (argument.kind) {
    case "type": return requiredTypeName(argument.type, currentModulePath);
    case "type-expression":
    case "compiler-expression": return argument.expression;
    case "static-string": return quoteMojoStaticString(argument.value);
    case "integer": return argument.value;
    case "boolean": return argument.value ? "True" : "False";
    case "value-reference": return argument.path.join(".");
    case "unbound": return "_";
  }
}

function quoteMojoStaticString(value: string): string {
  return JSON.stringify(value).replace(/\\u2028/gu, "\\u{2028}").replace(/\\u2029/gu, "\\u{2029}");
}

function requiredTypeName(type: MojoTargetTypeRef, currentModulePath: readonly string[]): string {
  const name = mojoTypeName(type, currentModulePath);
  if (name === undefined) throw new Error("Mojo unit cannot appear in a value type position.");
  return name;
}

function sameModulePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
