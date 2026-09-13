import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSourceProfilePropertyAccessPolicy } from "./source-profile-property-model.js";

interface IntlPropertyOwner {
  readonly target: string;
  readonly members: ReadonlyMap<string, string>;
}

const propertyOwners: ReadonlyMap<string, IntlPropertyOwner> = new Map([
  ["IntlResolvedCollatorOptions", {
    target: "IntlResolvedCollatorOptions",
    members: new Map([
      ["locale", "locale"], ["usage", "usage"], ["sensitivity", "sensitivity"],
      ["ignorePunctuation", "ignore_punctuation"], ["collation", "collation"],
      ["numeric", "numeric"], ["caseFirst", "case_first"],
    ]),
  }],
  ["IntlResolvedDateTimeFormatOptions", {
    target: "IntlResolvedDateTimeFormatOptions",
    members: new Map([
      ["locale", "locale"], ["calendar", "calendar"],
      ["numberingSystem", "numbering_system"], ["timeZone", "time_zone"],
    ]),
  }],
  ["IntlDateTimeFormatPart", {
    target: "IntlFormatPart",
    members: new Map([["type", "type"], ["value", "value"]]),
  }],
  ["IntlNumberFormatPart", {
    target: "IntlFormatPart",
    members: new Map([["type", "type"], ["value", "value"]]),
  }],
  ["IntlResolvedNumberFormatOptions", {
    target: "IntlResolvedNumberFormatOptions",
    members: new Map([
      ["locale", "locale"], ["numberingSystem", "numbering_system"],
      ["style", "style"], ["minimumIntegerDigits", "minimum_integer_digits"],
      ["minimumFractionDigits", "minimum_fraction_digits"],
      ["maximumFractionDigits", "maximum_fraction_digits"],
      ["minimumSignificantDigits", "minimum_significant_digits"],
      ["maximumSignificantDigits", "maximum_significant_digits"],
      ["useGrouping", "use_grouping"], ["currency", "currency"],
      ["currencyDisplay", "currency_display"], ["currencySign", "currency_sign"],
      ["unit", "unit"], ["unitDisplay", "unit_display"],
      ["notation", "notation"], ["compactDisplay", "compact_display"],
      ["signDisplay", "sign_display"], ["roundingPriority", "rounding_priority"],
      ["roundingIncrement", "rounding_increment"], ["roundingMode", "rounding_mode"],
      ["trailingZeroDisplay", "trailing_zero_display"],
    ]),
  }],
]);

export function mojoIntlSourceProfileProperty(
  owner: string, member: string, receiver: MojoTargetTypeRef,
): MojoSourceProfilePropertyAccessPolicy | undefined {
  const properties = propertyOwners.get(owner);
  if (properties === undefined || receiver.kind !== "target-named" ||
    receiver.id !== `tsonic.mojo.js.${properties.target}`) return undefined;
  const name = properties.members.get(member);
  return name === undefined ? undefined : Object.freeze({
    read: Object.freeze({ kind: "method", name: `get_${name}` }),
    write: Object.freeze({ kind: "method", name: `set_${name}` }),
    raises: false,
  });
}
