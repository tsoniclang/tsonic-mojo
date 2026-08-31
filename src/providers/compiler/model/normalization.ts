import { createHash } from "node:crypto";
import type {
  MojoCompilerAlias,
  MojoCompilerAssociatedAlias,
  MojoCompilerField,
  MojoCompilerFunction,
  MojoCompilerFunctionArgument,
  MojoCompilerGenericParameter,
  MojoCompilerModuleModel,
  MojoCompilerNamedPath,
  MojoCompilerPackageSnapshot,
  MojoCompilerStruct,
  MojoCompilerTrait,
  MojoCompilerType,
} from "./model.js";
import { mojoCompilerProviderProtocolVersion } from "./model.js";
import type {
  MojoDocAlias,
  MojoDocArgument,
  MojoDocDocument,
  MojoDocField,
  MojoDocFunctionGroup,
  MojoDocFunctionOverload,
  MojoDocNamedPath,
  MojoDocParameter,
  MojoDocStruct,
  MojoDocTrait,
  MojoDocTypeValue,
} from "./mojo-doc-schema.js";
import { parseMojoCompilerType } from "./type-parser.js";
import type { MojoCompilerTypeScope } from "./type-parser.js";

export function normalizeMojoDocModule(options: {
  readonly package: MojoCompilerPackageSnapshot;
  readonly modulePath: readonly string[];
  readonly sourceDigest: string;
  readonly document: MojoDocDocument;
}): MojoCompilerModuleModel {
  const moduleIdentity = compilerModuleIdentity(options.package, options.modulePath);
  const functions = normalizeFunctionGroups(
    options.document.decl.functions,
    moduleIdentity,
    emptyScope,
  );
  const declarations = [
    ...options.document.decl.structs.map((declaration) => normalizeStruct(declaration, moduleIdentity)),
    ...options.document.decl.traits.map((declaration) => normalizeTrait(declaration, moduleIdentity)),
    ...options.document.decl.aliases.map((declaration) => normalizeAlias(declaration, moduleIdentity, emptyScope)),
  ];
  requireUnique(functions, ({ identity }) => identity, "function overload");
  requireUnique(declarations, ({ identity }) => identity, "declaration");
  return Object.freeze({
    protocolVersion: mojoCompilerProviderProtocolVersion,
    packageId: options.package.id,
    packageAlias: options.package.alias,
    packageName: options.package.packageName,
    packageVersion: options.package.version,
    modulePath: Object.freeze([...options.modulePath]),
    moduleIdentity,
    sourceDigest: options.sourceDigest,
    documentVersion: options.document.version,
    functions: Object.freeze(functions),
    declarations: Object.freeze(declarations),
  });
}

function normalizeStruct(
  declaration: MojoDocStruct,
  moduleIdentity: string,
): MojoCompilerStruct {
  const identity = `${moduleIdentity}::struct:${declaration.name}`;
  const genericParameters = normalizeGenericParameters(declaration.parameters, emptyScope);
  const scope = scopeFor(genericParameters);
  const fields = declaration.fields.map((field) => normalizeField(field, identity, scope));
  const functions = normalizeFunctionGroups(declaration.functions, identity, scope);
  const aliases = declaration.aliases.map((alias) => normalizeAssociatedAlias(alias, identity, scope));
  requireUnique(fields, ({ name }) => name, `field on '${identity}'`);
  requireUnique(aliases, ({ name }) => name, `associated alias on '${identity}'`);
  return Object.freeze({
    kind: "struct",
    identity,
    name: declaration.name,
    genericParameters,
    convention: declaration.convention,
    parentTraits: Object.freeze(declaration.parentTraits.map(normalizeNamedPath)),
    aliases: Object.freeze(aliases),
    fields: Object.freeze(fields),
    functions: Object.freeze(functions),
    ...documentationOf(declaration),
  });
}

function normalizeTrait(
  declaration: MojoDocTrait,
  moduleIdentity: string,
): MojoCompilerTrait {
  const identity = `${moduleIdentity}::trait:${declaration.name}`;
  const fields = declaration.fields.map((field) => normalizeField(field, identity, selfScope));
  const functions = normalizeFunctionGroups(declaration.functions, identity, selfScope);
  const aliases = declaration.aliases.map((alias) => normalizeAssociatedAlias(alias, identity, selfScope));
  requireUnique(fields, ({ name }) => name, `field on '${identity}'`);
  requireUnique(aliases, ({ name }) => name, `associated alias on '${identity}'`);
  return Object.freeze({
    kind: "trait",
    identity,
    name: declaration.name,
    parentTraits: Object.freeze(declaration.parentTraits.map(normalizeNamedPath)),
    aliases: Object.freeze(aliases),
    fields: Object.freeze(fields),
    functions: Object.freeze(functions),
    ...documentationOf(declaration),
  });
}

function normalizeAlias(
  declaration: MojoDocAlias,
  ownerIdentity: string,
  parentScope: MojoCompilerTypeScope,
): MojoCompilerAlias {
  const identity = `${ownerIdentity}::alias:${declaration.name}`;
  const genericParameters = normalizeGenericParameters(declaration.parameters, parentScope);
  const scope = mergeScope(parentScope, scopeFor(genericParameters));
  return Object.freeze({
    kind: "alias",
    identity,
    name: declaration.name,
    genericParameters,
    ...(declaration.type === undefined
      ? {}
      : { type: parseMojoCompilerType(declaration.type, declaration.path, scope) }),
    ...(declaration.value === undefined ? {} : { value: declaration.value }),
    ...documentationOf(declaration),
  });
}

function normalizeAssociatedAlias(
  declaration: MojoDocAlias,
  ownerIdentity: string,
  parentScope: MojoCompilerTypeScope,
): MojoCompilerAssociatedAlias {
  const alias = normalizeAlias(declaration, ownerIdentity, parentScope);
  const { kind: _kind, ...associated } = alias;
  return Object.freeze(associated);
}

function normalizeField(
  field: MojoDocField,
  ownerIdentity: string,
  scope: MojoCompilerTypeScope,
): MojoCompilerField {
  return Object.freeze({
    identity: `${ownerIdentity}::field:${field.name}`,
    name: field.name,
    type: parseTypeValue(field, scope),
    ...documentationOf(field),
  });
}

function normalizeFunctionGroups(
  groups: readonly MojoDocFunctionGroup[],
  ownerIdentity: string,
  parentScope: MojoCompilerTypeScope,
): MojoCompilerFunction[] {
  return groups.flatMap((group) => group.overloads.map((overload) =>
    normalizeFunction(overload, ownerIdentity, parentScope)));
}

function normalizeFunction(
  overload: MojoDocFunctionOverload,
  ownerIdentity: string,
  parentScope: MojoCompilerTypeScope,
): MojoCompilerFunction {
  const genericParameters = normalizeGenericParameters(overload.parameters, parentScope);
  const scope = mergeScope(parentScope, scopeFor(genericParameters));
  const arguments_ = overload.args.map((argument) => normalizeArgument(argument, scope));
  const semanticIdentity = stableDigest({
    genericParameters,
    arguments: arguments_,
    result: overload.returns === undefined ? undefined : parseTypeValue(overload.returns, scope),
    raises: overload.raises,
    asynchronous: overload.async,
    static: overload.isStatic,
    implicitConversion: overload.isImplicitConversion,
    requiredImplementation: !overload.hasDefaultImplementation,
  });
  return Object.freeze({
    identity: `${ownerIdentity}::function:${overload.name}:${semanticIdentity}`,
    name: overload.name,
    genericParameters,
    arguments: Object.freeze(arguments_),
    ...(overload.returns === undefined ? {} : { result: parseTypeValue(overload.returns, scope) }),
    raises: overload.raises,
    asynchronous: overload.async,
    static: overload.isStatic,
    implicitConversion: overload.isImplicitConversion,
    requiredImplementation: !overload.hasDefaultImplementation,
    ...documentationOf(overload),
  });
}

function normalizeArgument(
  argument: MojoDocArgument,
  scope: MojoCompilerTypeScope,
): MojoCompilerFunctionArgument {
  const variadic = argument.name.startsWith("*");
  return Object.freeze({
    name: variadic ? argument.name.slice(1) : argument.name,
    convention: argument.convention,
    position: argument.passingKind === "pos"
      ? "positional"
      : argument.passingKind === "kw"
        ? "keyword"
        : "positional-or-keyword",
    type: parseTypeValue(argument, scope),
    ...(argument.default === undefined ? {} : { defaultValue: argument.default }),
    variadic,
  });
}

function normalizeGenericParameters(
  parameters: readonly MojoDocParameter[],
  parentScope: MojoCompilerTypeScope,
): readonly MojoCompilerGenericParameter[] {
  const knownTypes = new Set(parentScope.typeParameters ?? []);
  const knownValues = new Set(parentScope.valueParameters ?? []);
  const knownOrigins = new Set(parentScope.originParameters ?? []);
  const result: MojoCompilerGenericParameter[] = [];
  for (const parameter of parameters) {
    const kind = genericParameterKind(parameter);
    const scope = {
      typeParameters: knownTypes,
      valueParameters: knownValues,
      originParameters: knownOrigins,
    };
    const normalized = Object.freeze({
      kind,
      name: parameter.name,
      passingKind: parameter.passingKind === "inferred"
        ? "inferred" as const
        : parameter.passingKind === "pos"
          ? "positional" as const
          : "positional-or-keyword" as const,
      constraint: parseTypeValue(parameter, scope),
    });
    result.push(normalized);
    if (kind === "type") knownTypes.add(parameter.name);
    else if (kind === "value") knownValues.add(parameter.name);
    else knownOrigins.add(parameter.name);
  }
  requireUnique(result, ({ name }) => name, "generic parameter");
  return Object.freeze(result);
}

function genericParameterKind(parameter: MojoDocParameter): "type" | "value" | "origin" {
  if (parameter.type === "Origin" || parameter.path?.includes("/origin/") === true) return "origin";
  if (parameter.type === "AnyType" || parameter.path?.includes("/traits/") === true) return "type";
  return "value";
}

function parseTypeValue(
  value: MojoDocTypeValue,
  scope: MojoCompilerTypeScope,
): MojoCompilerType {
  return parseMojoCompilerType(value.type, value.path, scope);
}

function normalizeNamedPath(value: MojoDocNamedPath): MojoCompilerNamedPath {
  return Object.freeze({
    name: value.name,
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.condition === undefined ? {} : { condition: value.condition }),
  });
}

function documentationOf(value: { readonly summary: string; readonly description: string }): {
  readonly documentation?: string;
} {
  const documentation = [value.summary.trim(), value.description.trim()]
    .filter((part, index, values) => part.length > 0 && values.indexOf(part) === index)
    .join("\n\n");
  return documentation.length === 0 ? {} : { documentation };
}

function scopeFor(parameters: readonly MojoCompilerGenericParameter[]): MojoCompilerTypeScope {
  return {
    typeParameters: new Set(parameters.filter(({ kind }) => kind === "type").map(({ name }) => name)),
    valueParameters: new Set(parameters.filter(({ kind }) => kind === "value").map(({ name }) => name)),
    originParameters: new Set(parameters.filter(({ kind }) => kind === "origin").map(({ name }) => name)),
  };
}

function mergeScope(
  left: MojoCompilerTypeScope,
  right: MojoCompilerTypeScope,
): MojoCompilerTypeScope {
  return {
    typeParameters: new Set([...(left.typeParameters ?? []), ...(right.typeParameters ?? [])]),
    valueParameters: new Set([...(left.valueParameters ?? []), ...(right.valueParameters ?? [])]),
    originParameters: new Set([...(left.originParameters ?? []), ...(right.originParameters ?? [])]),
  };
}

function requireUnique<T>(
  values: readonly T[],
  identityOf: (value: T) => string,
  kind: string,
): void {
  const identities = new Set<string>();
  for (const value of values) {
    const identity = identityOf(value);
    if (identities.has(identity)) throw new Error(`Mojo compiler emitted duplicate ${kind} '${identity}'.`);
    identities.add(identity);
  }
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function compilerModuleIdentity(
  package_: Pick<MojoCompilerPackageSnapshot, "id" | "version" | "sourceDigest">,
  modulePath: readonly string[],
): string {
  return `${package_.id}@${package_.version}:${package_.sourceDigest}:${modulePath.join(".")}`;
}

const emptyScope: MojoCompilerTypeScope = Object.freeze({
  typeParameters: new Set<string>(),
  valueParameters: new Set<string>(),
  originParameters: new Set<string>(),
});

const selfScope: MojoCompilerTypeScope = emptyScope;
