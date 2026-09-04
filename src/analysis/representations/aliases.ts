import type { MojoAnalyzedTypeAlias } from "../program/model.js";
import type { MojoTypeAliasSelection } from "./model.js";
import type {
  MojoTargetConstArgument,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoOriginRef } from "../../target-model/origins/model.js";
import { mojoOriginEquals } from "../../target-model/origins/identity.js";
import {
  mojoTargetGenericArgumentsEqual,
  mojoTargetTypeEquals,
} from "../../target-model/types/equality.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";

export interface MojoAuthoredAliasCandidate {
  readonly alias: MojoAnalyzedTypeAlias;
  readonly modulePath: readonly string[];
}

interface AliasBindings {
  readonly typeParameters: ReadonlyMap<string, string>;
  readonly valueParameters: ReadonlySet<string>;
  readonly originParameters: ReadonlySet<string>;
  readonly types: Map<string, MojoTargetTypeRef>;
  readonly values: Map<string, MojoTargetGenericArgument>;
  readonly origins: Map<string, MojoOriginRef>;
}

export function selectMojoAuthoredTypeAlias(
  type: MojoTargetTypeRef,
  modulePath: readonly string[],
  candidates: readonly MojoAuthoredAliasCandidate[],
): Extract<MojoTypeAliasSelection, { readonly kind: "authored" }> | undefined {
  if (!isMeaningfullyNamedCarrier(type)) return undefined;
  const selections = candidates.flatMap((candidate) => {
    const local = pathsEqual(candidate.modulePath, modulePath);
    if (!local && !candidate.alias.exported) return [];
    const application = matchAlias(candidate.alias, candidate.modulePath, type);
    return application === undefined ? [] : [{ application, local }];
  });
  const localSelections = selections.filter((selection) => selection.local);
  const eligible = localSelections.length === 0 ? selections : localSelections;
  const selected = eligible.length === 1 ? eligible[0]!.application : undefined;
  return selected === undefined
    ? undefined
    : Object.freeze({
        kind: "authored",
        declaration: selected.declaration,
        name: selected.name,
        modulePath: selected.modulePath,
        genericArguments: selected.genericArguments,
        aliasedTypeKey: mojoTargetTypeKey(type),
      });
}

function isMeaningfullyNamedCarrier(type: MojoTargetTypeRef): boolean {
  if (type.kind === "union") return type.members.length >= 2;
  if (type.kind === "callable" || type.kind === "function") return true;
  if (type.kind === "tuple") return type.elements.length >= 4;
  return aliasTypeComplexity(type) >= 8;
}

function aliasTypeComplexity(type: MojoTargetTypeRef): number {
  switch (type.kind) {
    case "list": return 1 + aliasTypeComplexity(type.element);
    case "fixed-array": return 1 + aliasTypeComplexity(type.element);
    case "dictionary": return 1 + aliasTypeComplexity(type.key) + aliasTypeComplexity(type.value);
    case "future": return 1 + aliasTypeComplexity(type.output);
    case "optional": return 1 + aliasTypeComplexity(type.value);
    case "union": return 1 + type.members.reduce((sum, member) =>
      sum + aliasTypeComplexity(member), 0);
    case "tuple": return 1 + type.elements.reduce((sum, element) =>
      sum + aliasTypeComplexity(element), 0);
    case "associated": return 1 + aliasTypeComplexity(type.owner) +
      genericArgumentComplexity(type.genericArguments);
    case "reference": return 1 + aliasTypeComplexity(type.value);
    case "callable": return 1 + type.parameters.reduce((sum, parameter) =>
      sum + aliasTypeComplexity(parameter.type), aliasTypeComplexity(type.result)) +
      (type.errorType === undefined ? 0 : aliasTypeComplexity(type.errorType));
    case "function": return 1 + type.parameters.reduce((sum, parameter) =>
      sum + aliasTypeComplexity(parameter.type), aliasTypeComplexity(type.result)) +
      (type.errorType === undefined ? 0 : aliasTypeComplexity(type.errorType));
    case "target-named": return 1 + genericArgumentComplexity(type.genericArguments ?? []);
    default: return 1;
  }
}

function genericArgumentComplexity(
  arguments_: readonly MojoTargetGenericArgument[],
): number {
  return arguments_.reduce((sum, argument) =>
    sum + (argument.kind === "type" ? aliasTypeComplexity(argument.type) : 1), 0);
}

function matchAlias(
  alias: MojoAnalyzedTypeAlias,
  modulePath: readonly string[],
  actual: MojoTargetTypeRef,
): {
  readonly declaration: MojoAnalyzedTypeAlias["declaration"];
  readonly declarationIdentity: string;
  readonly name: string;
  readonly modulePath: readonly string[];
  readonly genericArguments: readonly MojoTargetGenericArgument[];
} | undefined {
  const bindings: AliasBindings = {
    typeParameters: new Map(alias.typeParameters
      .filter((parameter) => parameter.kind === "type")
      .map((parameter) => [parameter.identity, parameter.name] as const)),
    valueParameters: new Set(alias.typeParameters
      .filter((parameter) => parameter.kind === "value")
      .map((parameter) => parameter.name)),
    originParameters: new Set(alias.typeParameters
      .filter((parameter) => parameter.kind === "origin")
      .map((parameter) => parameter.name)),
    types: new Map(),
    values: new Map(),
    origins: new Map(),
  };
  if (!matchType(alias.value, actual, bindings)) return undefined;
  const genericArguments: MojoTargetGenericArgument[] = [];
  for (const parameter of alias.typeParameters) {
    const argument = parameter.kind === "type"
      ? typeArgument(bindings.types.get(parameter.name))
      : parameter.kind === "value"
        ? bindings.values.get(parameter.name)
        : originArgument(bindings.origins.get(parameter.name));
    if (argument === undefined) return undefined;
    genericArguments.push(argument);
  }
  const substitutionTypes = new Map(bindings.types);
  for (const parameter of alias.typeParameters) {
    if (parameter.kind !== "type") continue;
    const argument = bindings.types.get(parameter.name);
    if (argument !== undefined) substitutionTypes.set(parameter.identity, argument);
  }
  const substituted = substituteMojoTargetType(alias.value, {
    types: substitutionTypes,
    values: bindings.values,
    origins: bindings.origins,
    packs: new Map(),
  });
  if (!mojoTargetTypeEquals(substituted, actual)) return undefined;
  return Object.freeze({
    declaration: alias.declaration,
    declarationIdentity: alias.id,
    name: alias.name,
    modulePath: Object.freeze([...modulePath]),
    genericArguments: Object.freeze(genericArguments),
  });
}

function matchType(
  template: MojoTargetTypeRef,
  actual: MojoTargetTypeRef,
  bindings: AliasBindings,
): boolean {
  if (template.kind === "type-parameter") {
    const parameterName = template.identity === undefined
      ? undefined
      : bindings.typeParameters.get(template.identity);
    if (parameterName !== undefined) return bindType(parameterName, actual, bindings);
  }
  if (template.kind !== actual.kind) return false;
  switch (template.kind) {
    case "source-primitive": return actual.kind === "source-primitive" && template.name === actual.name;
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "bigint":
    case "symbol": return true;
    case "dynamic": return actual.kind === "dynamic" && template.domain === actual.domain;
    case "type-parameter": return actual.kind === "type-parameter" &&
      template.identity === actual.identity && template.name === actual.name;
    case "target-named": return actual.kind === "target-named" && template.id === actual.id &&
      matchGenericArguments(template.genericArguments ?? [], actual.genericArguments ?? [], bindings);
    case "list": return actual.kind === "list" && matchType(template.element, actual.element, bindings);
    case "fixed-array": return actual.kind === "fixed-array" &&
      matchType(template.element, actual.element, bindings) &&
      matchConstArgument(template.length, actual.length, bindings);
    case "dictionary": return actual.kind === "dictionary" &&
      matchType(template.key, actual.key, bindings) &&
      matchType(template.value, actual.value, bindings);
    case "future": return actual.kind === "future" && template.domain === actual.domain &&
      template.raises === actual.raises && matchType(template.output, actual.output, bindings);
    case "optional": return actual.kind === "optional" &&
      matchType(template.value, actual.value, bindings);
    case "union": return actual.kind === "union" &&
      matchTypes(template.members, actual.members, bindings);
    case "tuple": return actual.kind === "tuple" &&
      matchTypes(template.elements, actual.elements, bindings);
    case "associated": return actual.kind === "associated" &&
      arraysEqual(template.memberPath, actual.memberPath) &&
      matchType(template.owner, actual.owner, bindings) &&
      matchGenericArguments(template.genericArguments, actual.genericArguments, bindings);
    case "compiler-expression": return actual.kind === "compiler-expression" &&
      template.expression === actual.expression;
    case "reference": return actual.kind === "reference" && template.mutable === actual.mutable &&
      matchOrigin(template.origin, actual.origin, bindings) &&
      matchType(template.value, actual.value, bindings);
    case "callable": return actual.kind === "callable" && template.raises === actual.raises &&
      matchCallableParameters(template.parameters, actual.parameters, bindings) &&
      matchType(template.result, actual.result, bindings) &&
      matchOptionalType(template.errorType, actual.errorType, bindings);
    case "function": return actual.kind === "function" &&
      template.asynchronous === actual.asynchronous && template.thin === actual.thin &&
      template.raises === actual.raises && template.capture === actual.capture &&
      matchProviderParameters(template.genericParameters, actual.genericParameters, bindings) &&
      matchCallableParameters(template.parameters, actual.parameters, bindings) &&
      matchType(template.result, actual.result, bindings) &&
      matchOptionalType(template.errorType, actual.errorType, bindings);
  }
}

function matchTypes(
  templates: readonly MojoTargetTypeRef[],
  actuals: readonly MojoTargetTypeRef[],
  bindings: AliasBindings,
): boolean {
  return templates.length === actuals.length && templates.every((template, index) =>
    matchType(template, actuals[index]!, bindings));
}

function matchOptionalType(
  template: MojoTargetTypeRef | undefined,
  actual: MojoTargetTypeRef | undefined,
  bindings: AliasBindings,
): boolean {
  return template === undefined || actual === undefined
    ? template === actual
    : matchType(template, actual, bindings);
}

function matchCallableParameters(
  templates: readonly import("../../target-model/types/model.js").MojoTargetCallableParameter[],
  actuals: readonly import("../../target-model/types/model.js").MojoTargetCallableParameter[],
  bindings: AliasBindings,
): boolean {
  return templates.length === actuals.length && templates.every((template, index) => {
    const actual = actuals[index]!;
    return template.convention === actual.convention && template.passing === actual.passing &&
      (template.omissionKind ?? "required") === (actual.omissionKind ?? "required") &&
      matchType(template.type, actual.type, bindings);
  });
}

function matchProviderParameters(
  templates: readonly import("../../target-model/types/model.js").MojoProviderTargetGenericParameter[],
  actuals: readonly import("../../target-model/types/model.js").MojoProviderTargetGenericParameter[],
  bindings: AliasBindings,
): boolean {
  return templates.length === actuals.length && templates.every((template, index) => {
    const actual = actuals[index]!;
    return template.kind === actual.kind && template.name === actual.name &&
      template.position === actual.position && template.variadic === actual.variadic &&
      matchTypes(template.constraints, actual.constraints, bindings) &&
      matchOptionalGenericArgument(template.defaultArgument, actual.defaultArgument, bindings);
  });
}

function matchGenericArguments(
  templates: readonly MojoTargetGenericArgument[],
  actuals: readonly MojoTargetGenericArgument[],
  bindings: AliasBindings,
): boolean {
  return templates.length === actuals.length && templates.every((template, index) =>
    matchGenericArgument(template, actuals[index]!, bindings));
}

function matchOptionalGenericArgument(
  template: MojoTargetGenericArgument | undefined,
  actual: MojoTargetGenericArgument | undefined,
  bindings: AliasBindings,
): boolean {
  return template === undefined || actual === undefined
    ? template === actual
    : matchGenericArgument(template, actual, bindings);
}

function matchGenericArgument(
  template: MojoTargetGenericArgument,
  actual: MojoTargetGenericArgument,
  bindings: AliasBindings,
): boolean {
  if (template.kind === "type" && actual.kind === "type") {
    return template.name === actual.name && matchType(template.type, actual.type, bindings);
  }
  if (template.kind === "value-reference" && template.path.length === 1 &&
    bindings.valueParameters.has(template.path[0]!)) {
    return bindValue(template.path[0]!, actual, bindings);
  }
  if (template.kind === "origin" && actual.kind === "origin" &&
    template.origin.kind === "parameter" &&
    bindings.originParameters.has(template.origin.name)) {
    return template.name === actual.name &&
      bindOrigin(template.origin.name, actual.origin, bindings);
  }
  return mojoTargetGenericArgumentsEqual([template], [actual]);
}

function matchConstArgument(
  template: MojoTargetConstArgument,
  actual: MojoTargetConstArgument,
  bindings: AliasBindings,
): boolean {
  if (template.kind === "parameter" && bindings.valueParameters.has(template.name)) {
    const value: MojoTargetGenericArgument = actual.kind === "parameter"
      ? Object.freeze({ kind: "value-reference", path: Object.freeze([actual.name]) })
      : actual.kind === "integer"
        ? Object.freeze({ kind: "integer", value: actual.value })
        : Object.freeze({ kind: "boolean", value: actual.value });
    return bindValue(template.name, value, bindings);
  }
  return template.kind === actual.kind && (template.kind === "integer"
    ? actual.kind === "integer" && template.value === actual.value
    : template.kind === "boolean"
      ? actual.kind === "boolean" && template.value === actual.value
      : actual.kind === "parameter" && template.name === actual.name);
}

function matchOrigin(
  template: MojoOriginRef,
  actual: MojoOriginRef,
  bindings: AliasBindings,
): boolean {
  return template.kind === "parameter" && bindings.originParameters.has(template.name)
    ? bindOrigin(template.name, actual, bindings)
    : mojoOriginEquals(template, actual);
}

function bindType(name: string, value: MojoTargetTypeRef, bindings: AliasBindings): boolean {
  const existing = bindings.types.get(name);
  if (existing !== undefined) return mojoTargetTypeEquals(existing, value);
  bindings.types.set(name, value);
  return true;
}

function bindValue(
  name: string,
  value: MojoTargetGenericArgument,
  bindings: AliasBindings,
): boolean {
  if (value.kind === "type" || value.kind === "origin" || value.kind === "unbound") return false;
  const existing = bindings.values.get(name);
  if (existing !== undefined) return mojoTargetGenericArgumentsEqual([existing], [value]);
  bindings.values.set(name, value);
  return true;
}

function bindOrigin(name: string, value: MojoOriginRef, bindings: AliasBindings): boolean {
  const existing = bindings.origins.get(name);
  if (existing !== undefined) return mojoOriginEquals(existing, value);
  bindings.origins.set(name, value);
  return true;
}

function typeArgument(type: MojoTargetTypeRef | undefined): MojoTargetGenericArgument | undefined {
  return type === undefined ? undefined : Object.freeze({ kind: "type", type });
}

function originArgument(origin: MojoOriginRef | undefined): MojoTargetGenericArgument | undefined {
  return origin === undefined ? undefined : Object.freeze({ kind: "origin", origin });
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return arraysEqual(left, right);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
