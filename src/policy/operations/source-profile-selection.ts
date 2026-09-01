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
  readonly receiverCapability?: "integer";
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
  readonly callback?: MojoSourceProfileCallbackContract;
}

export interface MojoSourceProfileCallbackContract {
  readonly parameterIndex: number;
  readonly result: "preserve" | "bool" | "float64";
  readonly variants: readonly MojoSourceProfileCallbackVariant[];
}

export interface MojoSourceProfileCallbackVariant {
  readonly arity: number;
  readonly targetName: string;
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
  methods: readonly (string | readonly [string, string, boolean?])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name, raises] = typeof method === "string"
    ? [method, snakeCase(method), false] as const
    : method;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({ kind: "instance" as const, name, receiver }),
    ...(raises === true ? { raises: true } : {}),
  });
});

const jsStaticRows = (
  owner: string,
  methods: readonly (string | readonly [string, string, boolean?])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name, raises] = typeof method === "string"
    ? [method, `${snakeCase(owner.replace(/Constructor$/u, ""))}_${snakeCase(method)}`, false] as const
    : method;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({ kind: "function" as const, modulePath: Object.freeze(["tsonic_js"]), name }),
    ...(raises === true ? { raises: true } : {}),
  });
});

const jsReceiverFunctionRow = (
  owner: string,
  member: string,
  name: string,
  argumentCount: number,
  parameterContract: readonly MojoSourceProfileParameterContract[],
  raises = false,
): MojoSourceProfileCallRow => Object.freeze({
  profile: "js",
  kind: "call",
  owner,
  member,
  argumentCount,
  parameterContract: Object.freeze([...parameterContract]),
  target: Object.freeze({
    kind: "function",
    modulePath: Object.freeze(["tsonic_js"]),
    name,
    receiver: "imm",
  }),
  ...(raises ? { raises: true } : {}),
});

const jsConstructorRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  Object.freeze({
    profile: "js",
    kind: "construct",
    owner: "ArrayConstructor",
    member: "constructor",
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "array_new" }),
  }),
  ...["MapConstructor", "SetConstructor"].map((owner): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "construct",
    owner,
    member: "constructor",
    argumentCount: 0,
    parameterContract: Object.freeze([]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: `${snakeCase(owner.replace(/Constructor$/u, ""))}_new`,
    }),
  })),
  ...[0, 1].map((argumentCount): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "construct",
    owner: "DateConstructor",
    member: "constructor",
    argumentCount,
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "date_new" }),
  })),
]);

const arrayCallbackVariants = (
  names: readonly string[],
): readonly MojoSourceProfileCallbackVariant[] => Object.freeze(names.map((targetName, arity) =>
  Object.freeze({ arity, targetName })));

const jsCallbackRow = (
  owner: string,
  member: string,
  receiver: "imm" | "mut",
  result: MojoSourceProfileCallbackContract["result"],
  names: readonly string[],
  argumentCount?: number,
): MojoSourceProfileCallRow => Object.freeze({
  profile: "js",
  kind: "call",
  owner,
  member,
  ...(argumentCount === undefined ? {} : { argumentCount }),
  target: Object.freeze({
    kind: "function",
    modulePath: Object.freeze(["tsonic_js"]),
    name: names[names.length - 1]!,
    receiver,
  }),
  raises: true,
  callback: Object.freeze({
    parameterIndex: 0,
    result,
    variants: arrayCallbackVariants(names),
  }),
});

export const mojoSourceProfileCallRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  ...jsConstructorRows,
  ...jsInstanceRows("String", "imm", [
    "at", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "includes",
    "indexOf", "lastIndexOf", "padEnd", "padStart",
    ["repeat", "repeat", true], "slice", "startsWith",
    "substr", "substring", ["toLowerCase", "to_lower_case", true], "toString",
    ["toUpperCase", "to_upper_case", true], "toWellFormed",
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
    "copyWithin", "fill", "pop", "push", "reverse", "shift", "splice", "unshift",
  ]),
  ...jsInstanceRows("Array", "imm", [
    "at", "includes", "indexOf", "join", "lastIndexOf", "slice",
  ]),
  ...jsInstanceRows("ReadonlyArray", "imm", [
    "at", "includes", "indexOf", "join", "lastIndexOf", "slice",
  ]),
  ...["Array", "ReadonlyArray"].flatMap((owner) => [
    jsCallbackRow(owner, "map", "imm", "preserve", [
      "array_map_zero", "array_map_value", "array_map_with_index", "array_map_with_array",
    ]),
    jsCallbackRow(owner, "forEach", "imm", "preserve", [
      "array_for_each_zero", "array_for_each_value", "array_for_each_value_index", "array_for_each_with_array",
    ]),
    ...["filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex"].map((member) =>
      jsCallbackRow(owner, member, "imm", "bool", [
        `array_${snakeCase(member)}_zero`,
        `array_${snakeCase(member)}_value`,
        `array_${snakeCase(member)}_with_index`,
        `array_${snakeCase(member)}_with_array`,
      ])),
    jsCallbackRow(owner, "reduce", "imm", "preserve", [
      "array_reduce_from_first_zero",
      "array_reduce_from_first_accumulator",
      "array_reduce_from_first_value",
      "array_reduce_from_first_with_index",
      "array_reduce_from_first_with_array",
    ], 1),
    jsCallbackRow(owner, "reduce", "imm", "preserve", [
      "array_reduce_initial_zero",
      "array_reduce_initial_accumulator",
      "array_reduce_initial_value",
      "array_reduce_initial_with_index",
      "array_reduce_initial_with_array",
    ], 2),
  ]),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "Array",
    member: "sort",
    argumentCount: 0,
    target: Object.freeze({ kind: "instance", name: "sort", receiver: "mut" }),
  }),
  jsCallbackRow("Array", "sort", "mut", "float64", [
    "array_sort_zero", "array_sort_value", "array_sort_compare",
  ], 1),
  ...jsInstanceRows("Map", "mut", ["clear", "delete", "set"]),
  ...jsInstanceRows("Map", "imm", ["entries", "get", "has", "keys", "values"]),
  ...jsInstanceRows("ReadonlyMap", "imm", ["entries", "get", "has", "keys", "values"]),
  ...["Map", "ReadonlyMap"].map((owner) => jsCallbackRow(owner, "forEach", "imm", "preserve", [
    "map_for_each_zero", "map_for_each_value", "map_for_each_value_key", "map_for_each_with_map",
  ])),
  ...jsInstanceRows("Set", "mut", ["add", "clear", "delete"]),
  ...jsInstanceRows("Set", "imm", [
    "difference", "entries", "has", "intersection", "isDisjointFrom",
    "isSubsetOf", "isSupersetOf", "keys", "symmetricDifference", "union", "values",
  ]),
  ...jsInstanceRows("ReadonlySet", "imm", [
    "difference", "entries", "has", "intersection", "isDisjointFrom", "isSubsetOf",
    "isSupersetOf", "keys", "symmetricDifference", "union", "values",
  ]),
  ...["Set", "ReadonlySet"].map((owner) => jsCallbackRow(owner, "forEach", "imm", "preserve", [
    "set_for_each_zero", "set_for_each_value", "set_for_each_value_key", "set_for_each_with_set",
  ])),
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
  jsReceiverFunctionRow("Number", "toString", "number_to_string", 0, []),
  Object.freeze({
    ...jsReceiverFunctionRow(
      "Number", "toString", "number_to_string_radix", 1, ["float64"], true,
    ),
    receiverCapability: "integer",
  }),
  jsReceiverFunctionRow("Number", "valueOf", "number_value_of", 0, []),
  jsReceiverFunctionRow("Number", "toFixed", "number_to_fixed", 0, [], true),
  jsReceiverFunctionRow("Number", "toFixed", "number_to_fixed", 1, ["float64"], true),
  jsReceiverFunctionRow(
    "Number", "toExponential", "number_to_exponential_default", 0, [],
  ),
  jsReceiverFunctionRow(
    "Number", "toExponential", "number_to_exponential_digits", 1, ["float64"], true,
  ),
  jsReceiverFunctionRow(
    "Number", "toPrecision", "number_to_precision_default", 0, [],
  ),
  jsReceiverFunctionRow(
    "Number", "toPrecision", "number_to_precision_digits", 1, ["float64"], true,
  ),
  ...jsStaticRows("StringConstructor", ["fromCharCode", ["fromCodePoint", "string_from_code_point", true]]),
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
  ...[
    ["keys", "object_keys"],
    ["values", "object_values"],
    ["entries", "object_entries"],
  ].map(([member, name]): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "call",
    owner: "ObjectConstructor",
    member: member!,
    argumentCount: 1,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-value"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: name!,
    }),
    raises: true,
  })),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "ObjectConstructor",
    member: "hasOwn",
    argumentCount: 2,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-value", "js-string"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "object_has_own",
    }),
    raises: true,
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "Object",
    member: "hasOwnProperty",
    argumentCount: 1,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "object_has_own",
      receiver: "imm",
    }),
    raises: true,
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "JSON",
    member: "parse",
    argumentCount: 1,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "json_parse",
    }),
    raises: true,
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "JSON",
    member: "stringify",
    argumentCount: 1,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-value"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "json_stringify",
    }),
    raises: true,
  }),
  ...["isFinite", "isInteger", "isNaN", "isSafeInteger"].map((member) => Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner: "NumberConstructor",
    member,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["float64"]),
    target: Object.freeze({
      kind: "function" as const,
      modulePath: Object.freeze(["tsonic_js"]),
      name: member === "isNaN" ? "number_is_nan" : `number_${snakeCase(member)}`,
    }),
  })),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "NumberConstructor",
    member: "parseFloat",
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string"]),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "number_parse_float" }),
  }),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "NumberConstructor",
    member: "parseInt",
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-string", "float64"]),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "number_parse_int" }),
  }),
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
