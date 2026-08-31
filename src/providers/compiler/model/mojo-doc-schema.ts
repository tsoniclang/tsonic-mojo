export interface MojoDocTypeValue {
  readonly type: string;
  readonly path?: string;
  readonly doc?: string;
}

export interface MojoDocArgument extends MojoDocTypeValue {
  readonly kind: "argument";
  readonly name: string;
  readonly convention: "imm" | "mut" | "var" | "ref" | "out" | "deinit";
  readonly passingKind: "pos" | "pos_or_kw" | "kw";
  readonly default?: string;
  readonly description: string;
}

export interface MojoDocParameter extends MojoDocTypeValue {
  readonly kind: "parameter";
  readonly name: string;
  readonly passingKind: "pos" | "pos_or_kw" | "inferred";
  readonly description: string;
}

export interface MojoDocFunctionOverload {
  readonly kind: "function";
  readonly name: string;
  readonly args: readonly MojoDocArgument[];
  readonly parameters: readonly MojoDocParameter[];
  readonly returns?: MojoDocTypeValue;
  readonly raises: boolean;
  readonly async: boolean;
  readonly isStatic: boolean;
  readonly isImplicitConversion: boolean;
  readonly hasDefaultImplementation: boolean;
  readonly signature: string;
  readonly description: string;
  readonly summary: string;
}

export interface MojoDocFunctionGroup {
  readonly kind: "function";
  readonly name: string;
  readonly overloads: readonly MojoDocFunctionOverload[];
}

export interface MojoDocField extends MojoDocTypeValue {
  readonly kind: "field";
  readonly name: string;
  readonly description: string;
  readonly summary: string;
}

export interface MojoDocNamedPath {
  readonly name: string;
  readonly path?: string;
  readonly condition?: string;
}

export interface MojoDocAlias {
  readonly kind: "alias";
  readonly name: string;
  readonly parameters: readonly MojoDocParameter[];
  readonly type?: string;
  readonly path?: string;
  readonly value?: string;
  readonly signature: string;
  readonly description: string;
  readonly summary: string;
}

export interface MojoDocStruct {
  readonly kind: "struct";
  readonly name: string;
  readonly convention: string;
  readonly parameters: readonly MojoDocParameter[];
  readonly parentTraits: readonly MojoDocNamedPath[];
  readonly aliases: readonly MojoDocAlias[];
  readonly fields: readonly MojoDocField[];
  readonly functions: readonly MojoDocFunctionGroup[];
  readonly description: string;
  readonly summary: string;
}

export interface MojoDocTrait {
  readonly kind: "trait";
  readonly name: string;
  readonly parentTraits: readonly MojoDocNamedPath[];
  readonly aliases: readonly MojoDocAlias[];
  readonly fields: readonly MojoDocField[];
  readonly functions: readonly MojoDocFunctionGroup[];
  readonly description: string;
  readonly summary: string;
}

export interface MojoDocModule {
  readonly kind: "module";
  readonly name: string;
  readonly aliases: readonly MojoDocAlias[];
  readonly functions: readonly MojoDocFunctionGroup[];
  readonly structs: readonly MojoDocStruct[];
  readonly traits: readonly MojoDocTrait[];
  readonly description: string;
  readonly summary: string;
}

export interface MojoDocDocument {
  readonly version: string;
  readonly decl: MojoDocModule;
}

const moduleKeys = ["aliases", "description", "functions", "kind", "name", "structs", "summary", "traits"];
const groupKeys = ["kind", "name", "overloads"];
const overloadKeys = [
  "args", "async", "constraints", "deprecated", "description",
  "hasDefaultImplementation", "isImplicitConversion", "isStabilityTracked",
  "isStable", "isStatic", "kind", "name", "parameters", "raises",
  "raisesDoc", "returns", "signature", "sinceVersion", "summary",
];
const argumentKeys = ["convention", "default", "description", "kind", "name", "passingKind", "path", "type"];
const parameterKeys = ["description", "kind", "name", "passingKind", "path", "type"];
const structKeys = [
  "aliases", "constraints", "convention", "deprecated", "description", "fields",
  "functions", "isStabilityTracked", "isStable", "kind", "name", "parameters",
  "parentTraits", "signature", "sinceVersion", "summary",
];
const traitKeys = [
  "aliases", "deprecated", "description", "fields", "functions", "isStabilityTracked",
  "isStable", "kind", "name", "parentTraits", "sinceVersion", "summary",
];
const aliasKeys = [
  "deprecated", "description", "isStabilityTracked", "isStable", "kind", "name",
  "parameters", "path", "signature", "sinceVersion", "summary", "type", "value",
];
const fieldKeys = ["description", "kind", "name", "path", "summary", "type"];
const namedPathKeys = ["condition", "name", "path"];
const typeValueKeys = ["doc", "path", "type"];

export function parseMojoDocDocument(value: unknown): MojoDocDocument {
  const root = record(value, "document");
  exactKeys(root, ["decl", "version"], "document");
  const version = text(root.version, "document.version");
  const decl = parseModule(root.decl, "document.decl");
  return Object.freeze({ version, decl });
}

function parseModule(value: unknown, field: string): MojoDocModule {
  const input = record(value, field);
  exactKeys(input, moduleKeys, field);
  literal(input.kind, "module", `${field}.kind`);
  return Object.freeze({
    kind: "module",
    name: identifier(input.name, `${field}.name`),
    aliases: parseArray(input.aliases, `${field}.aliases`, parseAlias),
    functions: parseArray(input.functions, `${field}.functions`, parseFunctionGroup),
    structs: parseArray(input.structs, `${field}.structs`, parseStruct),
    traits: parseArray(input.traits, `${field}.traits`, parseTrait),
    description: text(input.description, `${field}.description`),
    summary: text(input.summary, `${field}.summary`),
  });
}

function parseFunctionGroup(value: unknown, field: string): MojoDocFunctionGroup {
  const input = record(value, field);
  exactKeys(input, groupKeys, field);
  literal(input.kind, "function", `${field}.kind`);
  const name = identifier(input.name, `${field}.name`);
  const overloads = parseArray(input.overloads, `${field}.overloads`, parseFunctionOverload);
  if (overloads.length === 0 || overloads.some((overload) => overload.name !== name)) {
    throw new Error(`Mojo documentation function group '${field}' has inconsistent overload names.`);
  }
  return Object.freeze({ kind: "function", name, overloads });
}

function parseFunctionOverload(value: unknown, field: string): MojoDocFunctionOverload {
  const input = record(value, field);
  exactKeys(input, overloadKeys, field);
  literal(input.kind, "function", `${field}.kind`);
  return Object.freeze({
    kind: "function",
    name: identifier(input.name, `${field}.name`),
    args: parseArray(input.args, `${field}.args`, parseArgument),
    parameters: parseArray(input.parameters, `${field}.parameters`, parseParameter),
    ...(input.returns === undefined ? {} : { returns: parseTypeValue(input.returns, `${field}.returns`) }),
    raises: boolean(input.raises, `${field}.raises`),
    async: boolean(input.async, `${field}.async`),
    isStatic: boolean(input.isStatic, `${field}.isStatic`),
    isImplicitConversion: boolean(input.isImplicitConversion, `${field}.isImplicitConversion`),
    hasDefaultImplementation: boolean(input.hasDefaultImplementation, `${field}.hasDefaultImplementation`),
    signature: text(input.signature, `${field}.signature`),
    description: text(input.description, `${field}.description`),
    summary: text(input.summary, `${field}.summary`),
  });
}

function parseArgument(value: unknown, field: string): MojoDocArgument {
  const input = record(value, field);
  exactKeys(input, argumentKeys, field);
  literal(input.kind, "argument", `${field}.kind`);
  const convention = oneOf(input.convention, ["imm", "mut", "var", "ref", "out", "deinit"], `${field}.convention`);
  const passingKind = oneOf(input.passingKind, ["pos", "pos_or_kw", "kw"], `${field}.passingKind`);
  return Object.freeze({
    kind: "argument",
    name: argumentName(input.name, `${field}.name`),
    convention,
    passingKind,
    ...parseTypeValue(input, field),
    ...(input.default === undefined ? {} : { default: text(input.default, `${field}.default`) }),
    description: text(input.description, `${field}.description`),
  });
}

function parseParameter(value: unknown, field: string): MojoDocParameter {
  const input = record(value, field);
  exactKeys(input, parameterKeys, field);
  literal(input.kind, "parameter", `${field}.kind`);
  return Object.freeze({
    kind: "parameter",
    name: identifier(input.name, `${field}.name`),
    passingKind: oneOf(input.passingKind, ["pos", "pos_or_kw", "inferred"], `${field}.passingKind`),
    ...parseTypeValue(input, field),
    description: text(input.description, `${field}.description`),
  });
}

function parseStruct(value: unknown, field: string): MojoDocStruct {
  const input = record(value, field);
  exactKeys(input, structKeys, field);
  literal(input.kind, "struct", `${field}.kind`);
  return Object.freeze({
    kind: "struct",
    name: identifier(input.name, `${field}.name`),
    convention: text(input.convention, `${field}.convention`),
    parameters: parseArray(input.parameters, `${field}.parameters`, parseParameter),
    parentTraits: parseArray(input.parentTraits, `${field}.parentTraits`, parseNamedPath),
    aliases: parseArray(input.aliases, `${field}.aliases`, parseAlias),
    fields: parseArray(input.fields, `${field}.fields`, parseField),
    functions: parseArray(input.functions, `${field}.functions`, parseFunctionGroup),
    description: text(input.description, `${field}.description`),
    summary: text(input.summary, `${field}.summary`),
  });
}

function parseTrait(value: unknown, field: string): MojoDocTrait {
  const input = record(value, field);
  exactKeys(input, traitKeys, field);
  literal(input.kind, "trait", `${field}.kind`);
  return Object.freeze({
    kind: "trait",
    name: identifier(input.name, `${field}.name`),
    parentTraits: parseArray(input.parentTraits, `${field}.parentTraits`, parseNamedPath),
    aliases: parseArray(input.aliases, `${field}.aliases`, parseAlias),
    fields: parseArray(input.fields, `${field}.fields`, parseField),
    functions: parseArray(input.functions, `${field}.functions`, parseFunctionGroup),
    description: text(input.description, `${field}.description`),
    summary: text(input.summary, `${field}.summary`),
  });
}

function parseAlias(value: unknown, field: string): MojoDocAlias {
  const input = record(value, field);
  exactKeys(input, aliasKeys, field);
  literal(input.kind, "alias", `${field}.kind`);
  return Object.freeze({
    kind: "alias",
    name: identifier(input.name, `${field}.name`),
    parameters: parseArray(input.parameters, `${field}.parameters`, parseParameter),
    ...(input.type === undefined ? {} : { type: text(input.type, `${field}.type`) }),
    ...(input.path === undefined ? {} : { path: text(input.path, `${field}.path`) }),
    ...(input.value === undefined ? {} : { value: text(input.value, `${field}.value`) }),
    signature: text(input.signature, `${field}.signature`),
    description: text(input.description, `${field}.description`),
    summary: text(input.summary, `${field}.summary`),
  });
}

function parseField(value: unknown, field: string): MojoDocField {
  const input = record(value, field);
  exactKeys(input, fieldKeys, field);
  literal(input.kind, "field", `${field}.kind`);
  return Object.freeze({
    kind: "field",
    name: identifier(input.name, `${field}.name`),
    ...parseTypeValue(input, field),
    description: text(input.description, `${field}.description`),
    summary: text(input.summary, `${field}.summary`),
  });
}

function parseNamedPath(value: unknown, field: string): MojoDocNamedPath {
  const input = record(value, field);
  exactKeys(input, namedPathKeys, field);
  return Object.freeze({
    name: text(input.name, `${field}.name`),
    ...(input.path === undefined ? {} : { path: text(input.path, `${field}.path`) }),
    ...(input.condition === undefined ? {} : { condition: text(input.condition, `${field}.condition`) }),
  });
}

function parseTypeValue(value: unknown, field: string): MojoDocTypeValue {
  const input = record(value, field);
  if (Object.keys(input).every((key) => typeValueKeys.includes(key))) exactKeys(input, typeValueKeys, field);
  return Object.freeze({
    type: text(input.type, `${field}.type`),
    ...(input.path === undefined ? {} : { path: text(input.path, `${field}.path`) }),
    ...(input.doc === undefined ? {} : { doc: text(input.doc, `${field}.doc`) }),
  });
}

function parseArray<T>(
  value: unknown,
  field: string,
  parse: (entry: unknown, field: string) => T,
): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`Mojo documentation '${field}' must be an array.`);
  return Object.freeze(value.map((entry, index) => parse(entry, `${field}[${index}]`)));
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Mojo documentation '${field}' must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowedKeys: readonly string[], field: string): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Mojo documentation '${field}' contains unsupported field '${unknown[0]}'.`);
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Mojo documentation '${field}' must be text.`);
  return value;
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^[_A-Za-z][_A-Za-z0-9]*$/u.test(result)) {
    throw new Error(`Mojo documentation '${field}' is not an identifier.`);
  }
  return result;
}

function argumentName(value: unknown, field: string): string {
  const result = text(value, field);
  const unwrapped = result.startsWith("*") ? result.slice(1) : result;
  if (!/^[_A-Za-z][_A-Za-z0-9]*$/u.test(unwrapped)) {
    throw new Error(`Mojo documentation '${field}' is not an argument name.`);
  }
  return result;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Mojo documentation '${field}' must be boolean.`);
  return value;
}

function literal<T extends string>(value: unknown, expected: T, field: string): T {
  if (value !== expected) throw new Error(`Mojo documentation '${field}' must be '${expected}'.`);
  return expected;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Mojo documentation '${field}' has unsupported value '${String(value)}'.`);
  }
  return value as T;
}
