import type {
  MojoProviderTargetGenericParameter,
  MojoTargetCallableParameter,
  MojoTargetConstArgument,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoOriginRef, MojoOriginToken } from "../../target-model/origins/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import {
  concat,
  delimitedList,
  emptyDocument,
  group,
  join,
  line,
  text,
} from "../document/builders.js";
import type { MojoDocument } from "../document/model.js";
import type { MojoPrintContext } from "./context.js";

export function printMojoTypeDocument(
  type: MojoTargetTypeRef,
  context: MojoPrintContext,
): MojoDocument | undefined {
  const key = mojoTargetTypeKey(type);
  const alias = context.aliasesByTypeKey.get(key);
  if (alias !== undefined && context.expandedAliasKey !== key) {
    return alias.genericArguments.length === 0
      ? text(alias.name)
      : concat(text(alias.name), printGenericArguments(alias.genericArguments, context));
  }
  switch (type.kind) {
    case "native-string": return text("String");
    case "unit": return undefined;
    case "never": return text("Never");
    case "null": return text(importedTypeName(context, ["tsonic_runtime"], "Null"));
    case "undefined": return text(importedTypeName(context, ["tsonic_runtime"], "Undefined"));
    case "dynamic": return text(type.domain === "js"
      ? importedTypeName(context, ["tsonic_js"], "JsValue")
      : importedTypeName(context, ["tsonic_runtime"], "TsValue"));
    case "bigint": return text(importedTypeName(context, ["tsonic_runtime"], "BigInt"));
    case "symbol": return text(importedTypeName(context, ["tsonic_js"], "JsSymbol"));
    case "type-parameter": return text(type.name);
    case "source-primitive": return printSourcePrimitive(type.name);
    case "target-named": {
      const base = sameModulePath(type.modulePath, context.modulePath)
        ? type.name
        : context.importedSymbols.get(`${type.modulePath.join(".")}\0${type.name}`) ??
          [...type.modulePath, type.name].join(".");
      return type.genericArguments === undefined || type.genericArguments.length === 0
        ? text(base)
        : concat(text(base), printGenericArguments(type.genericArguments, context));
    }
    case "list": return genericType(
      importedTypeName(context, ["std", "collections"], "List"),
      [requiredMojoTypeDocument(type.element, context)],
    );
    case "fixed-array": return genericType("Array", [
      requiredMojoTypeDocument(type.element, context),
      printConstArgument(type.length),
    ]);
    case "dictionary": return genericType(importedTypeName(context, ["std", "collections"], "Dict"), [
      requiredMojoTypeDocument(type.key, context),
      requiredMojoTypeDocument(type.value, context),
    ]);
    case "future": {
      const output = requiredMojoTypeDocument(type.output, context);
      if (type.domain === "js") {
        return genericType(importedTypeName(context, ["tsonic_js"], "JsPromise"), [output]);
      }
      return genericType(type.raises ? "RaisingCoroutine" : "Coroutine", [output, text("...")]);
    }
    case "optional": return genericType(
      importedTypeName(context, ["std", "collections"], "Optional"),
      [requiredMojoTypeDocument(type.value, context)],
    );
    case "union": return genericType(importedTypeName(context, ["std", "utils"], "Variant"), type.members.map((member) =>
      requiredMojoTypeDocument(member, context)));
    case "tuple": return genericType("Tuple", type.elements.map((element) =>
      requiredMojoTypeDocument(element, context)));
    case "associated": {
      const base = concat(
        requiredMojoTypeDocument(type.owner, context),
        text(`.${type.memberPath.join(".")}`),
      );
      return type.genericArguments.length === 0
        ? base
        : concat(base, printGenericArguments(type.genericArguments, context));
    }
    case "compiler-expression": return text(type.expression);
    case "reference": return concat(
      text("ref["),
      printMojoOriginDocument(type.origin),
      text("] "),
      requiredMojoTypeDocument(type.value, context),
    );
    case "callable": {
      const argumentsType = genericType("Tuple", type.parameters.map((parameter) =>
        requiredMojoTypeDocument(parameter.type, context)));
      const resultType = printMojoTypeDocument(type.result, context) ?? text("NoneType");
      return genericType(importedTypeName(
        context,
        ["tsonic_runtime"],
        type.raises ? "RaisingCallable" : "Callable",
      ), [
        argumentsType,
        resultType,
        ...(type.raises && type.errorType !== undefined
          ? [requiredMojoTypeDocument(type.errorType, context)]
          : []),
      ]);
    }
    case "function": {
      const generics = printMojoGenericParametersDocument(type.genericParameters, context);
      const parameters = delimitedList(
        "(",
        type.parameters.map((parameter) => printFunctionTypeParameter(parameter, context)),
        ")",
      );
      const capture = type.capture === undefined
        ? emptyDocument
        : type.capture === "*"
          ? text(" capturing")
          : concat(text(" capturing["), text(type.capture), text("]"));
      const error = type.raises
        ? concat(
            text(" raises"),
            type.errorType === undefined
              ? emptyDocument
              : concat(text(" "), requiredMojoTypeDocument(type.errorType, context)),
          )
        : emptyDocument;
      return group(concat(
        text(type.asynchronous ? "async def" : "def"),
        generics,
        parameters,
        type.thin ? text(" thin") : emptyDocument,
        capture,
        error,
        text(" -> "),
        printMojoTypeDocument(type.result, context) ?? text("None"),
      ));
    }
  }
}

export function requiredMojoTypeDocument(
  type: MojoTargetTypeRef,
  context: MojoPrintContext,
): MojoDocument {
  const result = printMojoTypeDocument(type, context);
  if (result === undefined) throw new Error("Mojo unit cannot appear in a value type position.");
  return result;
}

export function printMojoGenericParametersDocument(
  parameters: readonly MojoProviderTargetGenericParameter[],
  context: MojoPrintContext,
): MojoDocument {
  if (parameters.length === 0) return emptyDocument;
  const parts: MojoDocument[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.position === "keyword" && parameters[index - 1]?.position !== "keyword") {
      parts.push(text("*"));
    }
    const constraints = parameter.constraints.length === 0
      ? text("AnyType")
      : join(
          concat(line, text("& ")),
          parameter.constraints.map((constraint) => requiredMojoTypeDocument(constraint, context)),
        );
    const defaultArgument = parameter.defaultArgument === undefined
      ? emptyDocument
      : concat(text(" = "), printMojoGenericArgumentValueDocument(parameter.defaultArgument, context));
    parts.push(group(concat(
      text(`${parameter.variadic ? "*" : ""}${parameter.name}: `),
      constraints,
      defaultArgument,
    )));
    const next = parameters[index + 1];
    if (parameter.position === "inferred" && next?.position !== "inferred") parts.push(text("//"));
    else if (parameter.position === "positional" && next?.position !== "positional") parts.push(text("/"));
  }
  return delimitedList("[", parts, "]");
}

export function printMojoGenericArgumentValueDocument(
  argument: MojoTargetGenericArgument,
  context: MojoPrintContext,
): MojoDocument {
  switch (argument.kind) {
    case "type": return requiredMojoTypeDocument(argument.type, context);
    case "type-expression":
    case "compiler-expression": return text(argument.expression);
    case "static-string": return text(quoteMojoString(argument.value));
    case "integer": return text(argument.value);
    case "boolean": return text(argument.value ? "True" : "False");
    case "value-reference": return text(argument.path.join("."));
    case "origin": return printMojoOriginDocument(argument.origin);
    case "unbound": return text("_");
  }
}

export function printMojoOriginDocument(origin: MojoOriginRef): MojoDocument {
  switch (origin.kind) {
    case "static": return text("static");
    case "comptime": return text("comptime");
    case "inferred": return text("_");
    case "untracked": return genericType("UntrackedOrigin", [
      text(`mut=${origin.mutable ? "True" : "False"}`),
    ]);
    case "unsafe": return genericType("AnyOrigin", [
      text(`mut=${origin.mutable ? "True" : "False"}`),
    ]);
    case "parameter": return text(origin.name);
    case "provider-expression": return text(renderOriginTokens(origin.tokens));
  }
}

export function printGenericArguments(
  arguments_: readonly MojoTargetGenericArgument[],
  context: MojoPrintContext,
): MojoDocument {
  return delimitedList("[", arguments_.map((argument) => {
    const value = printMojoGenericArgumentValueDocument(argument, context);
    return argument.name === undefined ? value : concat(text(`${argument.name}=`), value);
  }), "]");
}

function printFunctionTypeParameter(
  parameter: MojoTargetCallableParameter,
  context: MojoPrintContext,
): MojoDocument {
  if (parameter.convention === "ref" && parameter.type.kind === "reference") {
    const prefix = concat(text("ref["), printMojoOriginDocument(parameter.type.origin), text("] "));
    return parameter.name === undefined
      ? concat(prefix, requiredMojoTypeDocument(parameter.type.value, context))
      : concat(prefix, text(`${parameter.name}: `), requiredMojoTypeDocument(parameter.type.value, context));
  }
  const convention = parameter.convention === "imm" ? "" : `${parameter.convention} `;
  return parameter.name === undefined
    ? concat(text(convention), requiredMojoTypeDocument(parameter.type, context))
    : concat(text(`${convention}${parameter.name}: `), requiredMojoTypeDocument(parameter.type, context));
}

function printSourcePrimitive(name: Extract<MojoTargetTypeRef, { kind: "source-primitive" }>["name"]): MojoDocument | undefined {
  switch (name) {
    case "bool": return text("Bool");
    case "char": return text("UInt16");
    case "int8": return text("Int8");
    case "uint8": return text("UInt8");
    case "int16": return text("Int16");
    case "uint16": return text("UInt16");
    case "int32": return text("Int32");
    case "uint32": return text("UInt32");
    case "int64": return text("Int64");
    case "uint64": return text("UInt64");
    case "native-int": return text("Int");
    case "native-uint": return text("UInt");
    case "float16": return text("Float16");
    case "float32": return text("Float32");
    case "float64": return text("Float64");
    case "int128": return text("Int128");
    case "uint128": return text("UInt128");
    case "decimal": return undefined;
  }
}

function printConstArgument(argument: MojoTargetConstArgument): MojoDocument {
  switch (argument.kind) {
    case "integer": return text(argument.value);
    case "boolean": return text(argument.value ? "True" : "False");
    case "parameter": return text(argument.name);
  }
}

function genericType(name: string, arguments_: readonly MojoDocument[]): MojoDocument {
  return concat(text(name), delimitedList("[", arguments_, "]"));
}

function renderOriginTokens(tokens: readonly MojoOriginToken[]): string {
  let result = "";
  for (const token of tokens) {
    if (token.text === ",") {
      result = `${result.trimEnd()}, `;
      continue;
    }
    if (token.text === "." || token.text === "[" || token.text === "(" ||
      token.text === "]" || token.text === ")" || token.text === "=") {
      result += token.text;
      continue;
    }
    const previous = result[result.length - 1];
    if (result.length > 0 && previous !== "." && previous !== "[" && previous !== "(" &&
      previous !== "=" && previous !== " ") {
      result += " ";
    }
    result += token.text;
  }
  return result.trim();
}

function quoteMojoString(value: string): string {
  return JSON.stringify(value).replace(/\\u2028/gu, "\\u{2028}").replace(/\\u2029/gu, "\\u{2029}");
}

function sameModulePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function importedTypeName(
  context: MojoPrintContext,
  modulePath: readonly string[],
  name: string,
): string {
  return context.importedSymbols.get(`${modulePath.join(".")}\0${name}`) ??
    [...modulePath, name].join(".");
}
