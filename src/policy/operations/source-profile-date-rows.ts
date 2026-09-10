import type {
  MojoSourceProfileCallRow,
  MojoSourceProfileParameterContract,
} from "./source-profile-selection.js";
import {
  jsInstanceRows,
  jsReceiverFunctionRows,
  jsStaticRows,
} from "./source-profile-row-builders.js";

const suppliedNumber: MojoSourceProfileParameterContract = Object.freeze({
  kind: "optional", value: "float64",
});

const numberParameters = (required: number, total: number): readonly MojoSourceProfileParameterContract[] =>
  Object.freeze(Array.from({ length: total }, (_, index) => index < required ? "float64" : suppliedNumber));

const fields = Object.freeze([
  ["FullYear", "full_year"], ["Month", "month"], ["Date", "date"],
  ["Day", "day"], ["Hours", "hours"], ["Minutes", "minutes"],
  ["Seconds", "seconds"], ["Milliseconds", "milliseconds"],
] as const);

const setters = Object.freeze([
  ["FullYear", "full_year", 3], ["Month", "month", 2], ["Date", "date", 1],
  ["Hours", "hours", 4], ["Minutes", "minutes", 3], ["Seconds", "seconds", 2],
  ["Milliseconds", "milliseconds", 1],
] as const);

export const mojoDateSourceProfileCallRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  ...([
    ["toLocaleString", "date_to_locale_string"],
    ["toLocaleDateString", "date_to_locale_date_string"],
    ["toLocaleTimeString", "date_to_locale_time_string"],
  ] as const).map(([member, name]): MojoSourceProfileCallRow => Object.freeze({
    profile: "js", kind: "call", owner: "Date", member, raises: true,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["js-data", "js-data"]),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name, receiver: "imm" }),
  })),
  ...jsInstanceRows("Date", "imm", ["getTime", "valueOf"]),
  ...fields.flatMap(([source, target]) => [
    ...jsInstanceRows("Date", "imm", [[`getUTC${source}`, `get_utc_${target}`]]),
    ...jsInstanceRows("Date", "imm", [[`get${source}`, `get_${target}`, true]]),
  ]),
  ...jsInstanceRows("Date", "imm", [["getTimezoneOffset", "get_timezone_offset", true]]),
  ...jsInstanceRows("Date", "mut", ["setTime"]),
  ...setters.flatMap(([source, target, arity]) => [false, true].map((local): MojoSourceProfileCallRow =>
    Object.freeze({
      profile: "js",
      kind: "call",
      owner: "Date",
      member: `set${local ? "" : "UTC"}${source}`,
      parameterContract: numberParameters(1, arity),
      ...(local ? { raises: true } : {}),
      target: Object.freeze({ kind: "instance", name: `set_${local ? "" : "utc_"}${target}`, receiver: "mut" }),
    }))),
  ...jsReceiverFunctionRows("Date", "date", [
    ["toISOString", "to_iso_string_native", true],
    ["toJSON", "to_json_native", true],
    ["toUTCString", "to_utc_string_native"],
    ["toString", "to_string_native", true],
    ["toDateString", "to_date_string_native", true],
    ["toTimeString", "to_time_string_native", true],
  ]),
  ...jsStaticRows("DateConstructor", ["now", ["parse", "date_parse_native", true]]),
  Object.freeze({
    profile: "js", kind: "call", owner: "DateConstructor", member: "UTC",
    parameterContract: numberParameters(1, 7),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "date_utc" }),
  }),
  ...Array.from({ length: 8 }, (_, argumentCount): MojoSourceProfileCallRow => Object.freeze({
    profile: "js", kind: "construct", owner: "DateConstructor", member: "constructor",
    argumentCount,
    ...(argumentCount === 0 ? {} : { raises: true }),
    ...(argumentCount < 2 ? {} : { parameterContract: numberParameters(2, 7) }),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "date_new" }),
  })),
]);
