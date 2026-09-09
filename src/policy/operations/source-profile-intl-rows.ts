import type { MojoSourceProfileCallRow } from "./source-profile-selection.js";
import { jsInstanceRows } from "./source-profile-row-builders.js";

export const mojoIntlSourceProfileCallRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  Object.freeze({
    profile: "js", kind: "construct", owner: "IntlCollatorConstructor", member: "constructor", raises: true,
    parameterContract: Object.freeze(["js-data", "js-data"]),
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "intl_collator_new" }),
  }),
  ...jsInstanceRows("IntlCollator", "imm", [["compare", "compare", true], ["resolvedOptions", "resolved_options", true]]),
]);
