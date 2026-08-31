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
  MojoCompilerTypeArgument,
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
import { parseMojoCompilerConformanceCondition } from "./condition-parser.js";
import { parseMojoCompilerType } from "./type-parser.js";
import type { MojoCompilerTypeScope } from "./type-parser.js";
import {
  createModuleScope,
  mergeScope,
  scopeFor,
  withGenericTypeParameters,
} from "./type-scope.js";

export function normalizeMojoDocModule(options: {
  readonly package: MojoCompilerPackageSnapshot;
  readonly modulePath: readonly string[];
  readonly sourceDigest: string;
  readonly document: MojoDocDocument;
  readonly requestedExports?: readonly string[];
  readonly resolveTypePath: (name: string, compilerPath?: string) => string | undefined;
  readonly classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin";
  readonly classifyAlias: (
    request: MojoAliasClassificationRequest,
  ) => "type" | "value" | "origin";
}): MojoCompilerModuleModel {
  const moduleIdentity = compilerModuleIdentity(options.package, options.modulePath);
  const moduleScope = createModuleScope(options);
  const availableExports = collectAvailableExports(options.document);
  const selected = selectRequestedExports(availableExports, options.requestedExports);
  const functions = normalizeFunctionGroups(
    options.document.decl.functions.filter(({ name }) => selected.has(name)),
    moduleIdentity,
    moduleScope,
    emptyParameters,
    options.classifyGenericParameter,
  );
  const declarations = [
    ...options.document.decl.structs.filter(({ name }) => selected.has(name)).map((declaration) =>
      normalizeWithContext("struct", declaration.name, () => normalizeStruct(
        declaration,
        moduleIdentity,
        moduleScope,
        options.classifyGenericParameter,
        options.classifyAlias,
      ))),
    ...options.document.decl.traits.filter(({ name }) => selected.has(name)).map((declaration) =>
      normalizeWithContext("trait", declaration.name, () => normalizeTrait(
        declaration,
        moduleIdentity,
        moduleScope,
        options.classifyGenericParameter,
        options.classifyAlias,
      ))),
    ...options.document.decl.aliases.filter(({ name }) => selected.has(name)).map((declaration) =>
      normalizeWithContext("alias", declaration.name, () => normalizeAlias(
        declaration,
        moduleIdentity,
        moduleScope,
        emptyParameters,
        options.classifyGenericParameter,
        options.classifyAlias,
      ))),
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
    availableExports,
    functions: Object.freeze(functions),
    declarations: Object.freeze(declarations),
  });
}

function collectAvailableExports(
  document: MojoDocDocument,
): readonly { readonly name: string; readonly kind: "function" | "struct" | "trait" | "alias" }[] {
  const values = [
    ...document.decl.functions.map(({ name }) => Object.freeze({ name, kind: "function" as const })),
    ...document.decl.structs.map(({ name }) => Object.freeze({ name, kind: "struct" as const })),
    ...document.decl.traits.map(({ name }) => Object.freeze({ name, kind: "trait" as const })),
    ...document.decl.aliases.map(({ name }) => Object.freeze({ name, kind: "alias" as const })),
  ];
  requireUnique(values, ({ name }) => name, "module export");
  return Object.freeze(values.sort(compareExport));
}

function selectRequestedExports(
  available: readonly { readonly name: string }[],
  requested: readonly string[] | undefined,
): ReadonlySet<string> {
  const availableNames = new Set(available.map(({ name }) => name));
  if (requested === undefined) return availableNames;
  const selected = new Set<string>();
  for (const name of requested) {
    if (!availableNames.has(name)) {
      throw new Error(`Mojo module has no exported declaration '${name}'.`);
    }
    selected.add(name);
  }
  return selected;
}

function compareExport(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function normalizeWithContext<T>(kind: string, name: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new Error(
      `Mojo ${kind} '${name}' cannot be normalized: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface MojoGenericParameterClassificationRequest {
  readonly parameter: MojoDocParameter;
  readonly parentParameters: readonly MojoDocParameter[];
  readonly precedingParameters: readonly MojoDocParameter[];
}

export interface MojoAliasClassificationRequest {
  readonly declaration: MojoDocAlias;
  readonly genericParameters: readonly MojoCompilerGenericParameter[];
  readonly owner?: {
    readonly kind: "struct" | "trait";
    readonly name: string;
    readonly parameters: readonly MojoDocParameter[];
    readonly genericParameters: readonly MojoCompilerGenericParameter[];
  };
}

function normalizeStruct(
  declaration: MojoDocStruct,
  moduleIdentity: string,
  moduleScope: MojoCompilerTypeScope,
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
  classifyAlias: (request: MojoAliasClassificationRequest) => "type" | "value" | "origin",
): MojoCompilerStruct {
  const identity = `${moduleIdentity}::struct:${declaration.name}`;
  const genericParameters = normalizeGenericParameters(
    declaration.parameters,
    moduleScope,
    emptyParameters,
    classifyGenericParameter,
  );
  const scope = mergeScope(
    moduleScope,
    withGenericTypeParameters(scopeFor(genericParameters), declaration.name, genericParameters),
  );
  const fields = declaration.fields.map((field) => normalizeField(field, identity, scope));
  const functions = normalizeFunctionGroups(
    declaration.functions,
    identity,
    scope,
    declaration.parameters,
    classifyGenericParameter,
  );
  const owner = Object.freeze({
    kind: "struct" as const,
    name: declaration.name,
    parameters: declaration.parameters,
    genericParameters,
  });
  const aliases = declaration.aliases.map((alias) => normalizeAssociatedAlias(
    alias,
    identity,
    scope,
    declaration.parameters,
    classifyGenericParameter,
    classifyAlias,
    owner,
  ));
  requireUnique(fields, ({ name }) => name, `field on '${identity}'`);
  requireUnique(aliases, ({ name }) => name, `associated alias on '${identity}'`);
  return Object.freeze({
    kind: "struct",
    identity,
    name: declaration.name,
    genericParameters,
    convention: declaration.convention,
    parentTraits: Object.freeze(declaration.parentTraits.map((trait) =>
      normalizeNamedPath(trait, scope))),
    aliases: Object.freeze(aliases),
    fields: Object.freeze(fields),
    functions: Object.freeze(functions),
    ...documentationOf(declaration),
  });
}

function normalizeTrait(
  declaration: MojoDocTrait,
  moduleIdentity: string,
  moduleScope: MojoCompilerTypeScope,
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
  classifyAlias: (request: MojoAliasClassificationRequest) => "type" | "value" | "origin",
): MojoCompilerTrait {
  const identity = `${moduleIdentity}::trait:${declaration.name}`;
  const scope = mergeScope(moduleScope, selfScope);
  const fields = declaration.fields.map((field) => normalizeField(field, identity, scope));
  const functions = normalizeFunctionGroups(
    declaration.functions,
    identity,
    scope,
    emptyParameters,
    classifyGenericParameter,
  );
  const owner = Object.freeze({
    kind: "trait" as const,
    name: declaration.name,
    parameters: emptyParameters,
    genericParameters: Object.freeze([]),
  });
  const aliases = declaration.aliases.map((alias) => normalizeAssociatedAlias(
    alias,
    identity,
    scope,
    emptyParameters,
    classifyGenericParameter,
    classifyAlias,
    owner,
  ));
  requireUnique(fields, ({ name }) => name, `field on '${identity}'`);
  requireUnique(aliases, ({ name }) => name, `associated alias on '${identity}'`);
  return Object.freeze({
    kind: "trait",
    identity,
    name: declaration.name,
    parentTraits: Object.freeze(declaration.parentTraits.map((trait) =>
      normalizeNamedPath(trait, scope))),
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
  parentParameters: readonly MojoDocParameter[],
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
  classifyAlias: (request: MojoAliasClassificationRequest) => "type" | "value" | "origin",
  owner?: MojoAliasClassificationRequest["owner"],
): MojoCompilerAlias {
  const identity = `${ownerIdentity}::alias:${declaration.name}`;
  const genericParameters = normalizeGenericParameters(
    declaration.parameters,
    parentScope,
    parentParameters,
    classifyGenericParameter,
  );
  const scope = mergeScope(parentScope, scopeFor(genericParameters));
  const category = classifyAlias(Object.freeze({ declaration, genericParameters, ...(owner === undefined ? {} : { owner }) }));
  if (declaration.value === undefined) {
    throw new Error(`Mojo alias '${declaration.name}' has no compiler-retained value expression.`);
  }
  return Object.freeze({
    kind: "alias",
    identity,
    name: declaration.name,
    genericParameters,
    category,
    ...(category === "type"
      ? { targetType: parseMojoCompilerType(declaration.value, undefined, scope) }
      : declaration.type === undefined || declaration.type.trim().length === 0
        ? {}
        : { valueType: parseMojoCompilerType(declaration.type, undefined, scope) }),
    valueExpression: declaration.value,
    ...documentationOf(declaration),
  });
}

function normalizeAssociatedAlias(
  declaration: MojoDocAlias,
  ownerIdentity: string,
  parentScope: MojoCompilerTypeScope,
  parentParameters: readonly MojoDocParameter[],
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
  classifyAlias: (request: MojoAliasClassificationRequest) => "type" | "value" | "origin",
  owner: NonNullable<MojoAliasClassificationRequest["owner"]>,
): MojoCompilerAssociatedAlias {
  const identity = `${ownerIdentity}::alias:${declaration.name}`;
  const genericParameters = normalizeGenericParameters(
    declaration.parameters,
    parentScope,
    parentParameters,
    classifyGenericParameter,
  );
  const scope = mergeScope(parentScope, scopeFor(genericParameters));
  const category = classifyAlias(Object.freeze({ declaration, genericParameters, owner }));
  if (declaration.value === undefined) {
    throw new Error(`Mojo associated alias '${declaration.name}' has no compiler-retained value expression.`);
  }
  const abstract = declaration.value.trim().length === 0;
  if (abstract && owner.kind !== "trait") {
    throw new Error(`Mojo struct alias '${declaration.name}' has no concrete value expression.`);
  }
  return Object.freeze({
    identity,
    name: declaration.name,
    genericParameters,
    category,
    abstract,
    ...(category === "type"
      ? abstract
        ? {}
        : { targetType: parseMojoCompilerType(declaration.value, undefined, scope) }
      : declaration.type === undefined || declaration.type.trim().length === 0
          ? {}
          : { valueType: parseMojoCompilerType(declaration.type, undefined, scope) }),
    ...(abstract ? {} : { valueExpression: declaration.value }),
    ...documentationOf(declaration),
  });
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
  parentParameters: readonly MojoDocParameter[],
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
): MojoCompilerFunction[] {
  return groups.flatMap((group) => group.overloads.map((overload) =>
    normalizeFunction(
      overload,
      ownerIdentity,
      parentScope,
      parentParameters,
      classifyGenericParameter,
    )));
}

function normalizeFunction(
  overload: MojoDocFunctionOverload,
  ownerIdentity: string,
  parentScope: MojoCompilerTypeScope,
  parentParameters: readonly MojoDocParameter[],
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
): MojoCompilerFunction {
  const genericParameters = normalizeGenericParameters(
    overload.parameters,
    parentScope,
    parentParameters,
    classifyGenericParameter,
  );
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
    name: variadic ? argument.name.replace(/^\*{1,2}/u, "") : argument.name,
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
  parentParameters: readonly MojoDocParameter[],
  classifyGenericParameter: (
    request: MojoGenericParameterClassificationRequest,
  ) => "type" | "value" | "origin",
): readonly MojoCompilerGenericParameter[] {
  const knownTypes = new Set(parentScope.typeParameters ?? []);
  const knownValues = new Set(parentScope.valueParameters ?? []);
  const knownOrigins = new Set(parentScope.originParameters ?? []);
  const result: MojoCompilerGenericParameter[] = [];
  for (const [index, parameter] of parameters.entries()) {
    const variadic = parameter.name.startsWith("*");
    const name = variadic ? parameter.name.slice(1) : parameter.name;
    const kind = classifyGenericParameter(Object.freeze({
      parameter,
      parentParameters,
      precedingParameters: Object.freeze(parameters.slice(0, index)),
    }));
    const scope = {
      typeParameters: knownTypes,
      valueParameters: knownValues,
      originParameters: knownOrigins,
      ...(parentScope.genericTypeParameters === undefined
        ? {}
        : { genericTypeParameters: parentScope.genericTypeParameters }),
      ...(parentScope.resolveTypePath === undefined ? {} : { resolveTypePath: parentScope.resolveTypePath }),
    };
    const normalized = Object.freeze({
      kind,
      name,
      passingKind: parameter.passingKind === "inferred"
        ? "inferred" as const
        : parameter.passingKind === "pos"
          ? "positional" as const
          : parameter.passingKind === "kw"
            ? "keyword" as const
            : "positional-or-keyword" as const,
      variadic,
      constraints: Object.freeze((parameter.traits ?? [parameter]).map((constraint) =>
        parseTypeValue(constraint, scope))),
      ...(parameter.default === undefined
        ? {}
        : { defaultArgument: normalizeGenericDefault(parameter.default, kind, scope) }),
    });
    result.push(normalized);
    if (kind === "type") knownTypes.add(name);
    else if (kind === "value") knownValues.add(name);
    else knownOrigins.add(name);
  }
  requireUnique(result, ({ name }) => name, "generic parameter");
  return Object.freeze(result);
}

function normalizeGenericDefault(
  expression: string,
  kind: "type" | "value" | "origin",
  scope: MojoCompilerTypeScope,
): MojoCompilerTypeArgument {
  return kind === "type"
    ? Object.freeze({ kind: "type", type: parseMojoCompilerType(expression, undefined, scope) })
    : Object.freeze({ kind: "value", expression });
}

function parseTypeValue(
  value: MojoDocTypeValue,
  scope: MojoCompilerTypeScope,
): MojoCompilerType {
  return parseMojoCompilerType(value.type, value.path, scope);
}

function normalizeNamedPath(
  value: MojoDocNamedPath,
  scope: MojoCompilerTypeScope,
): MojoCompilerNamedPath {
  return Object.freeze({
    name: value.name,
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.condition === undefined
      ? {}
      : { condition: parseMojoCompilerConformanceCondition(value.condition, scope) }),
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
const emptyParameters: readonly MojoDocParameter[] = Object.freeze([]);
