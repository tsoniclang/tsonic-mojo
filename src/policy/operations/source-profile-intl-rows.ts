import type { MojoSourceProfileCallRow, MojoSourceProfileParameterContract } from "./source-profile-selection.js";
import { jsInstanceRows } from "./source-profile-row-builders.js";

export const mojoIntlSourceProfileCallRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  Object.freeze({
    profile: "js", kind: "construct", owner: "IntlCollatorConstructor", member: "constructor", raises: true,
    parameterContract: Object.freeze(["js-data", "js-data"]),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "intl_collator_new" }),
  }),
  ...jsInstanceRows("IntlCollator", "imm", [["compare", "compare", true], ["resolvedOptions", "resolved_options", true]]),
  Object.freeze({
    profile: "js", kind: "construct", owner: "IntlDateTimeFormatConstructor", member: "constructor", raises: true,
    parameterContract: Object.freeze(["js-data", "js-data"]),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "intl_datetime_format_new" }),
  }),
  ...jsInstanceRows("IntlDateTimeFormat", "imm", [["resolvedOptions", "resolved_options", true]]),
  ...[0, 1].flatMap((argumentCount) => [
    ["format", "format"], ["formatToParts", "format_to_parts"],
  ].map(([member, name]): MojoSourceProfileCallRow => Object.freeze({
    profile: "js", kind: "call", owner: "IntlDateTimeFormat", member, argumentCount, raises: true,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(argumentCount === 0 ? [] : ["selected-argument"]),
    target: Object.freeze({ kind: "instance", name, receiver: "imm" }),
  }))),
]);
