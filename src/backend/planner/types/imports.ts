import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoSymbolImport } from "../program/context.js";
import { mojoTargetTypeKey } from "../../../target-model/types/key.js";

export function registerMojoTypeImports(
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
  expandedAliasKey?: string,
): void {
  const typeKey = mojoTargetTypeKey(type);
  if (typeKey !== expandedAliasKey) {
    const alias = context.program.representations.aliasForType(type, context.module.modulePath);
    if (alias !== undefined) {
      const name = alias.kind === "authored" &&
          !sameModulePath(alias.modulePath, context.module.modulePath)
        ? registerMojoSymbolImport(context, alias.modulePath, alias.name)
        : alias.name;
      const existing = context.typeAliases.get(typeKey);
      if (existing !== undefined && (existing.name !== name ||
        JSON.stringify(existing.genericArguments) !== JSON.stringify(alias.genericArguments))) {
        throw new Error(`Mojo type '${typeKey}' has conflicting selected aliases.`);
      }
      context.typeAliases.set(typeKey, Object.freeze({
        typeKey,
        name,
        genericArguments: alias.genericArguments,
      }));
      for (const argument of alias.genericArguments) {
        if (argument.kind === "type") registerMojoTypeImports(argument.type, context);
      }
      return;
    }
  }
  switch (type.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "never":
    case "type-parameter":
    case "compiler-expression":
      return;
    case "null":
      registerMojoSymbolImport(context, ["tsonic_runtime"], "Null");
      return;
    case "undefined":
      registerMojoSymbolImport(context, ["tsonic_runtime"], "Undefined");
      return;
    case "bigint":
      registerMojoSymbolImport(context, ["tsonic_runtime"], "BigInt");
      return;
    case "dynamic":
      registerMojoSymbolImport(
        context,
        [type.domain === "js" ? "tsonic_js" : "tsonic_runtime"],
        type.domain === "js" ? "JsValue" : "TsValue",
      );
      return;
    case "symbol":
      registerMojoSymbolImport(context, ["tsonic_js"], "JsSymbol");
      return;
    case "target-named":
      if (!sameModulePath(type.modulePath, context.module.modulePath)) {
        registerMojoSymbolImport(context, type.modulePath, type.name);
      }
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
      if (type.domain === "js") registerMojoSymbolImport(context, ["tsonic_js"], "JsPromise");
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
      registerMojoSymbolImport(
        context,
        ["tsonic_runtime"],
        type.raises ? "RaisingCallable" : "Callable",
      );
      for (const parameter of type.parameters) registerMojoTypeImports(parameter.type, context);
      registerMojoTypeImports(type.result, context);
      if (type.errorType !== undefined) registerMojoTypeImports(type.errorType, context);
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

function sameModulePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
