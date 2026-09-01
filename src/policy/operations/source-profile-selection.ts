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
    semantics,
    source.sourceFacts,
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
      semantics,
      source.sourceFacts,
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
      source.semantics.forNode(declaration),
      source.sourceFacts,
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

const jsConstructorRows = ["ArrayConstructor", "MapConstructor", "SetConstructor", "DateConstructor", "RegExpConstructor"]
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
    "indexOf", "lastIndexOf", "match", "matchAll", "normalize", "padEnd", "padStart",
    "repeat", "replace", "replaceAll", "search", "slice", "startsWith",
    "substr", "substring", "toLowerCase", "toString", "toUpperCase", "toWellFormed",
    "trim", "trimEnd", "trimLeft", "trimRight", "trimStart", "valueOf", "isWellFormed",
  ]),
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
  }),
  ...jsInstanceRows("Array", "mut", [
    "copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift",
  ]),
  ...jsInstanceRows("Array", "imm", [
    "at", "entries", "every", "filter", "find", "findIndex", "findLast", "findLastIndex",
    "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "reduce",
    "slice", "some", "values",
  ]),
  ...jsInstanceRows("ReadonlyArray", "imm", [
    "at", "entries", "every", "filter", "find", "findIndex", "findLast", "findLastIndex",
    "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "reduce",
    "slice", "some", "values",
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
    "getTime", "getUTCDate", "getUTCDay", "getUTCFullYear", "getUTCHours",
    "getUTCMilliseconds", "getUTCMinutes", "getUTCMonth", "getUTCSeconds",
    "toJSON", "toString", "toUTCString", "valueOf",
  ]),
  ...jsInstanceRows("Date", "mut", [
    "setTime", "setUTCDate", "setUTCFullYear", "setUTCHours",
    "setUTCMilliseconds", "setUTCMinutes", "setUTCMonth", "setUTCSeconds",
  ]),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "Date",
    member: "toISOString",
    target: Object.freeze({ kind: "instance", name: "to_iso_string", receiver: "imm" }),
    raises: true,
  }),
  ...jsInstanceRows("RegExp", "mut", ["exec", "test"]),
  ...jsStaticRows("ArrayConstructor", ["from", "isArray"]),
  ...jsStaticRows("StringConstructor", ["fromCharCode", "fromCodePoint"]),
  ...jsStaticRows("DateConstructor", ["now", "parse", ["UTC", "date_utc"]]),
  ...jsStaticRows("JSON", ["parse", "stringify"]),
  ...jsStaticRows("ObjectConstructor", ["entries", "hasOwn", "is", "keys", "values"]),
  ...jsStaticRows("NumberConstructor", [
    "isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt",
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
