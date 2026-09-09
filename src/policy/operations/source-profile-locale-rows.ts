import type { MojoSourceProfileCallRow } from "./source-profile-selection.js";

export const mojoLocaleSourceProfileCallRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  ...[
    ["toLocaleLowerCase", "string_to_locale_lower_case"],
    ["toLocaleUpperCase", "string_to_locale_upper_case"],
  ].map(([member, name]): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "call",
    owner: "String",
    member: member!,
    raises: true,
    parameterContract: Object.freeze(["js-data"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: name!,
      receiver: "imm",
    }),
  })),
  Object.freeze({
    profile: "js",
    kind: "call",
    owner: "String",
    member: "localeCompare",
    raises: true,
    parameterContract: Object.freeze(["native-string", "js-data", "js-data"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "string_locale_compare",
      receiver: "imm",
    }),
  }),
]);
