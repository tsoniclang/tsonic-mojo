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
