import type {
  MojoCompilerType,
  MojoCompilerTypeArgument,
  MojoCompilerTypeDeclaration,
  MojoCompilerGenericParameter,
} from "../model/model.js";

export function resolveMojoAssociatedType(
  type: Extract<MojoCompilerType, { readonly kind: "self" | "associated" }>,
  ownerName: string | undefined,
  declarations: ReadonlyMap<string, MojoCompilerTypeDeclaration>,
  modulePath: string,
  resolving: ReadonlySet<string>,
): { readonly type: MojoCompilerType; readonly resolving: ReadonlySet<string> } {
  const owner = type.kind === "self"
    ? ownerName === undefined ? undefined : declarations.get(ownerName)
    : type.owner.kind === "self"
      ? ownerName === undefined ? undefined : declarations.get(ownerName)
      : type.owner.kind === "named" && (type.owner.path === undefined || type.owner.path === `${modulePath}/${type.owner.name}`)
        ? declarations.get(type.owner.name)
        : undefined;
  if (owner === undefined || owner.kind === "alias") {
    throw new Error("An open associated type requires an exact source projection for its selected owner; the provider type-expression contract has no associated/indexed-access form.");
  }
  const name = type.memberPath[0];
  const aliases = owner.aliases.filter((alias) => alias.name === name);
  const alias = aliases.length === 1 ? aliases[0] : undefined;
  if (alias === undefined || alias.abstract || alias.category !== "type" || alias.targetType === undefined) {
    throw new Error(`Associated type '${owner.name}.${type.memberPath.join(".")}' has no exact concrete compiler alias definition.`);
  }
  if (resolving.has(alias.identity)) {
    throw new Error(`Associated type '${owner.name}.${alias.name}' has a cyclic compiler alias definition.`);
  }
  const arguments_ = type.memberPath.length === 1 ? type.arguments : [];
  const bindings = new Map<string, MojoCompilerTypeArgument>();
  if (type.kind === "associated" && type.owner.kind === "named" && owner.kind === "struct") {
    bindParameters(owner.genericParameters, type.owner.arguments, bindings, owner.name);
  }
  const self: MojoCompilerType = Object.freeze({ kind: "named", name: owner.name, path: `${modulePath}/${owner.name}`,
    arguments: Object.freeze(owner.kind === "struct" ? owner.genericParameters.map((parameter): MojoCompilerTypeArgument =>
      bindings.get(parameter.name) ?? (parameter.kind === "type"
        ? { kind: "type", type: { kind: "type-parameter", name: parameter.name } }
        : { kind: "value", expression: parameter.name })) : []),
  });
  for (const parameter of alias.genericParameters) bindings.delete(parameter.name);
  bindParameters(alias.genericParameters, arguments_, bindings, `${owner.name}.${alias.name}`);
  const resolved = substituteCompilerType(alias.targetType, bindings, self);
  return Object.freeze({
    type: type.memberPath.length === 1 ? resolved : Object.freeze({
      kind: "associated",
      owner: resolved,
      memberPath: Object.freeze(type.memberPath.slice(1)),
      arguments: type.arguments,
    }),
    resolving: new Set([...resolving, alias.identity]),
  });
}

function bindParameters(
  parameters: readonly MojoCompilerGenericParameter[], arguments_: readonly MojoCompilerTypeArgument[],
  bindings: Map<string, MojoCompilerTypeArgument>, owner: string,
): void {
  const remaining = [...arguments_];
  for (const parameter of parameters) {
    const named = remaining.findIndex((argument) => argument.name === parameter.name);
    const position = named >= 0 ? named : parameter.passingKind === "keyword" ? -1
      : remaining.findIndex((argument) => argument.name === undefined);
    const selected = position >= 0 ? remaining.splice(position, 1)[0] : parameter.defaultArgument;
    if (selected === undefined || selected.kind === "unbound" || parameter.variadic) {
      throw new Error(`Associated type '${owner}' has inconsistent selected generic arity for '${parameter.name}'.`);
    }
    const resolved = substituteCompilerArgument(selected, bindings);
    if (parameter.kind === "type" ? resolved.kind !== "type" && resolved.kind !== "type-expression"
      : resolved.kind !== "value") {
      throw new Error(`Associated type '${owner}' has a contradictory argument category for '${parameter.name}'.`);
    }
    bindings.set(parameter.name, resolved);
  }
  if (remaining.length !== 0) throw new Error(`Associated type '${owner}' has inconsistent selected generic arity.`);
}

function substituteCompilerArgument(
  argument: MojoCompilerTypeArgument,
  bindings: ReadonlyMap<string, MojoCompilerTypeArgument>,
  self?: MojoCompilerType,
): MojoCompilerTypeArgument {
  const name = argument.kind === "type" && argument.type.kind === "type-parameter"
    ? argument.type.name : argument.kind === "value" ? argument.expression : undefined;
  const bound = name === undefined ? undefined : bindings.get(name);
  if (bound !== undefined) {
    const value = { ...bound };
    delete value.name;
    return Object.freeze(argument.name === undefined ? value : { ...value, name: argument.name });
  }
  if (argument.kind === "type") return Object.freeze({ ...argument, type: substituteCompilerType(argument.type, bindings, self) });
  if (argument.kind === "type-expression") return Object.freeze({ ...argument, sourceType: substituteCompilerType(argument.sourceType, bindings, self) });
  return argument;
}

function substituteCompilerType(
  type: MojoCompilerType,
  bindings: ReadonlyMap<string, MojoCompilerTypeArgument>,
  self?: MojoCompilerType,
): MojoCompilerType {
  switch (type.kind) {
    case "type-parameter": {
      const bound = bindings.get(type.name);
      if (bound === undefined) return type;
      if (bound.kind !== "type") throw new Error(`Associated type parameter '${type.name}' is bound to a non-type argument.`);
      return bound.type;
    }
    case "self": {
      if (self !== undefined) return type.memberPath.length === 0 ? self : Object.freeze({ kind: "associated", owner: self,
        memberPath: type.memberPath, arguments: Object.freeze(type.arguments.map((argument) => substituteCompilerArgument(argument, bindings, self))),
      });
      return type;
    }
    case "named": return Object.freeze({ ...type, arguments: Object.freeze(type.arguments.map((argument) => substituteCompilerArgument(argument, bindings, self))) });
    case "associated": return Object.freeze({
      ...type, owner: substituteCompilerType(type.owner, bindings, self),
      arguments: Object.freeze(type.arguments.map((argument) => substituteCompilerArgument(argument, bindings, self))),
    });
    case "tuple": return Object.freeze({ ...type, elements: Object.freeze(type.elements.map((element) => substituteCompilerType(element, bindings, self))) });
    case "reference": {
      const origin = bindings.get(type.origin);
      if (origin !== undefined && origin.kind !== "value") throw new Error(`Associated reference origin '${type.origin}' is not an origin value.`);
      return Object.freeze({ ...type, origin: origin?.kind === "value" ? origin.expression : type.origin, target: substituteCompilerType(type.target, bindings, self) });
    }
    case "compiler-expression": return type;
    case "function": {
      const nested = new Map(bindings);
      for (const parameter of type.genericParameters) nested.delete(parameter.name);
      return Object.freeze({
        ...type,
        genericParameters: Object.freeze(type.genericParameters.map((parameter) => Object.freeze({ ...parameter,
          constraints: Object.freeze(parameter.constraints.map((constraint) => substituteCompilerType(constraint, nested, self))),
          ...(parameter.defaultArgument === undefined ? {} : { defaultArgument: substituteCompilerArgument(parameter.defaultArgument, nested, self) }),
        }))),
        parameters: Object.freeze(type.parameters.map((parameter) => Object.freeze({ ...parameter, type: substituteCompilerType(parameter.type, nested, self) }))),
        ...(type.result === undefined ? {} : { result: substituteCompilerType(type.result, nested, self) }),
        ...(type.errorType === undefined ? {} : { errorType: substituteCompilerType(type.errorType, nested, self) }),
      });
    }
  }
}
