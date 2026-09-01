import type { Node, ResolvedSourceCallInfo } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type {
  MojoSourceProfileDeclarationIdentity,
  MojoSourceProfileRegistry,
} from "../types/source-profile.js";

export interface MojoSourceProfileCallRow {
  readonly profile: "native" | "js";
  readonly kind: "call" | "construct";
  readonly owner: string;
  readonly member: string;
  readonly argumentCount?: number;
  readonly parameterContract?: readonly MojoSourceProfileParameterContract[];
  readonly target:
    | {
        readonly kind: "instance";
        readonly name: string;
        readonly receiver: "imm" | "mut" | "var" | "ref" | "deinit";
      }
    | {
        readonly kind: "function";
        readonly modulePath: readonly string[];
        readonly name: string;
        readonly receiver?: "imm" | "mut" | "var" | "ref" | "deinit";
      };
  readonly raises?: boolean;
}

export type MojoSourceProfileParameterContract =
  | "float64"
  | "js-string"
  | "js-value";

export type MojoSourceProfileCallRowSelection =
  | { readonly kind: "not-source-profile" }
  | {
      readonly kind: "selected";
      readonly identity: MojoSourceProfileDeclarationIdentity;
      readonly row: MojoSourceProfileCallRow;
    }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function selectMojoSourceProfileCallRow(
  source: TargetSourceProgram,
  call: ResolvedSourceCallInfo,
  profiles: MojoSourceProfileRegistry,
): MojoSourceProfileCallRowSelection {
  const semantics = source.semantics.forNode(call.call);
  const signatureDeclaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
  const identity = profiles.declarationIdentity(
    signatureDeclaration,
    source,
  );
  if (identity === undefined) return { kind: "not-source-profile" };
  const expectedKind = source.ast.is.IsNewExpression(call.call) ? "construct" : "call";
  const owner = identity.declaringName ?? identity.name;
  const member = expectedKind === "construct"
    ? "constructor"
    : identity.name;
  if (owner === undefined || member === undefined ||
    (identity.kind !== expectedKind && identity.kind !== "member")) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALL_IDENTITY_INCOMPLETE",
      reason: "The exact selected source-profile signature has no closed owner, member, and call kind.",
    };
  }
  const calleeIdentities = [
    call.sourceCallee.selectedDeclaration,
    call.sourceCalleeAccess?.selectedDeclaration,
  ].flatMap((declaration) => {
    const selected = profiles.declarationIdentity(
      declaration,
      source,
    );
    return selected === undefined ? [] : [selected];
  });
  if (calleeIdentities.some((selected) => selected.profile !== identity.profile)) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALL_IDENTITY_CONFLICT",
      reason: "The exact selected signature and callee declarations belong to different source profiles.",
    };
  }
  const argumentCount = call.sourceArguments.length;
  const rows = mojoSourceProfileCallRows.filter((row) =>
    row.profile === identity.profile && row.kind === expectedKind &&
    row.owner === owner && row.member === member &&
    (row.argumentCount === undefined || row.argumentCount === argumentCount));
  if (rows.length !== 1) {
    return {
      kind: "unsupported",
      code: rows.length === 0
        ? "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED"
        : "MOJO_SOURCE_PROFILE_CALL_AMBIGUOUS",
      reason: `The exact source-profile call '${owner}.${member}' with ${argumentCount} arguments has ${rows.length} Mojo policy rows.`,
    };
  }
  return Object.freeze({ kind: "selected", identity, row: rows[0]! });
}

export function selectedMojoSourceProfileDeclarationIdentity(
  source: TargetSourceProgram,
  profiles: MojoSourceProfileRegistry,
  declarations: readonly (Node | undefined)[],
): MojoSourceProfileDeclarationIdentity | undefined {
  let selected: MojoSourceProfileDeclarationIdentity | undefined;
  for (const declaration of declarations) {
    if (declaration === undefined) continue;
    const identity = profiles.declarationIdentity(
      declaration,
      source,
    );
    if (identity === undefined) continue;
    if (selected !== undefined && !sameSourceProfileIdentity(selected, identity)) return undefined;
    selected = identity;
  }
  return selected;
}

function sameSourceProfileIdentity(
  left: MojoSourceProfileDeclarationIdentity,
  right: MojoSourceProfileDeclarationIdentity,
): boolean {
  return left.profile === right.profile && left.kind === right.kind &&
    left.declaringName === right.declaringName && left.name === right.name;
}

const jsInstanceRows = (
  owner: string,
  receiver: "imm" | "mut",
  methods: readonly (string | readonly [string, string])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name] = typeof method === "string"
    ? [method, snakeCase(method)]
    : method;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({ kind: "instance" as const, name, receiver }),
  });
});

const jsStaticRows = (
  owner: string,
  methods: readonly (string | readonly [string, string])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name] = typeof method === "string"
    ? [method, `${snakeCase(owner.replace(/Constructor$/u, ""))}_${snakeCase(method)}`]
    : method;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({ kind: "function" as const, modulePath: Object.freeze(["tsonic_js"]), name }),
  });
});

const jsConstructorRows = ["ArrayConstructor", "MapConstructor", "SetConstructor", "DateConstructor"]
  .map((owner): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "construct",
    owner,
    member: "constructor",
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: `${snakeCase(owner.replace(/Constructor$/u, ""))}_new`,
    }),
  }));

export const mojoSourceProfileCallRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  ...jsConstructorRows,
  ...jsInstanceRows("String", "imm", [
    "at", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "includes",
    "indexOf", "lastIndexOf", "padEnd", "padStart",
    "repeat", "slice", "startsWith",
    "substr", "substring", "toLowerCase", "toString", "toUpperCase", "toWellFormed",
    "trim", "trimEnd", "trimLeft", "trimRight", "trimStart", "valueOf", "isWellFormed",
  ]),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "String",
    member: "replace",
    target: Object.freeze({ kind: "instance", name: "replace", receiver: "imm" }),
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string", "js-string"]),
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "String",
    member: "replaceAll",
    target: Object.freeze({ kind: "instance", name: "replace_all", receiver: "imm" }),
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string", "js-string"]),
    raises: true,
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "String",
    member: "split",
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "string_split",
      receiver: "imm",
    }),
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string", "float64"]),
  }),
  ...jsInstanceRows("Array", "mut", [
    "copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift",
  ]),
  ...jsInstanceRows("Array", "imm", [
    "at", "every", "filter", "find", "findIndex", "findLast", "findLastIndex",
    "forEach", "includes", "indexOf", "join", "lastIndexOf", "map", "reduce",
    "slice", "some",
  ]),
  ...jsInstanceRows("ReadonlyArray", "imm", [
    "at", "every", "filter", "find", "findIndex", "findLast", "findLastIndex",
    "forEach", "includes", "indexOf", "join", "lastIndexOf", "map", "reduce",
    "slice", "some",
  ]),
  ...jsInstanceRows("Map", "mut", ["clear", "delete", "set"]),
  ...jsInstanceRows("Map", "imm", ["entries", "forEach", "get", "has", "keys", "values"]),
  ...jsInstanceRows("ReadonlyMap", "imm", ["entries", "forEach", "get", "has", "keys", "values"]),
  ...jsInstanceRows("Set", "mut", ["add", "clear", "delete"]),
  ...jsInstanceRows("Set", "imm", [
    "difference", "entries", "forEach", "has", "intersection", "isDisjointFrom",
    "isSubsetOf", "isSupersetOf", "keys", "symmetricDifference", "union", "values",
  ]),
  ...jsInstanceRows("ReadonlySet", "imm", ["entries", "forEach", "has", "keys", "values"]),
  ...jsInstanceRows("Date", "imm", [
    "getTime", ["getUTCDate", "get_utc_date"], ["getUTCDay", "get_utc_day"],
    ["getUTCFullYear", "get_utc_full_year"], ["getUTCHours", "get_utc_hours"],
    ["getUTCMilliseconds", "get_utc_milliseconds"], ["getUTCMinutes", "get_utc_minutes"],
    ["getUTCMonth", "get_utc_month"], ["getUTCSeconds", "get_utc_seconds"],
    ["toJSON", "to_json"], "toString", ["toUTCString", "to_utc_string"], "valueOf",
  ]),
  ...jsInstanceRows("Date", "mut", [
    "setTime", ["setUTCDate", "set_utc_date"], ["setUTCFullYear", "set_utc_full_year"],
    ["setUTCHours", "set_utc_hours"], ["setUTCMilliseconds", "set_utc_milliseconds"],
    ["setUTCMinutes", "set_utc_minutes"], ["setUTCMonth", "set_utc_month"],
    ["setUTCSeconds", "set_utc_seconds"],
  ]),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "Date",
    member: "toISOString",
    target: Object.freeze({ kind: "instance", name: "to_iso_string", receiver: "imm" }),
    raises: true,
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "Boolean",
    member: "toString",
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "boolean_to_string",
      receiver: "imm",
    }),
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "Boolean",
    member: "valueOf",
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "boolean_value_of",
      receiver: "imm",
    }),
  }),
  ...jsStaticRows("StringConstructor", ["fromCharCode", "fromCodePoint"]),
  ...jsStaticRows("DateConstructor", ["now", "parse", ["UTC", "date_utc"]]),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "ObjectConstructor",
    member: "is",
    argumentCount: 2,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-value", "js-value"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "object_is",
    }),
  }),
  ...jsStaticRows("NumberConstructor", [
    "isFinite", "isInteger", ["isNaN", "number_is_nan"], "isSafeInteger",
    "parseFloat", "parseInt",
  ]),
  ...jsStaticRows("Math", [
    "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "ceil",
    "clz32", "cos", "cosh", "exp", "expm1", "floor", "fround", "hypot", "imul", "log",
    "log10", "log1p", "log2", "max", "min", "pow", "random", "round", "sign", "sin",
    "sinh", "sqrt", "tan", "tanh", "trunc",
  ]),
  ...jsStaticRows("Console", [
    ["debug", "console_debug"],
    ["error", "console_error"],
    ["info", "console_info"],
    ["log", "console_log"],
    ["warn", "console_warn"],
  ]),
]);

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/gu, (letter, index) => `${index === 0 ? "" : "_"}${letter.toLowerCase()}`);
}
