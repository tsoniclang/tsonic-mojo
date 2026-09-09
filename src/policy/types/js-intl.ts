import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { namedType } from "./resolution-helpers.js";
import { implicitHeapLifecycle } from "./lifecycle-contracts.js";

const typeNames: ReadonlyMap<string, string> = new Map([
  ["IntlCollator", "IntlCollator"],
  ["IntlResolvedCollatorOptions", "IntlResolvedCollatorOptions"],
  ["IntlDateTimeFormat", "IntlDateTimeFormat"],
  ["IntlResolvedDateTimeFormatOptions", "IntlResolvedDateTimeFormatOptions"],
  ["IntlDateTimeFormatPart", "IntlFormatPart"],
]);

export function mojoIntlSourceProfileType(name: string): MojoTargetTypeRef | undefined {
  const target = typeNames.get(name);
  return target === undefined ? undefined : namedType(`tsonic.mojo.js.${target}`, ["tsonic_js"], target, [], implicitHeapLifecycle);
}
