import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSourceProfilePropertyAccessPolicy } from "./source-profile-property-model.js";

const collatorProperties: ReadonlyMap<string, string> = new Map([
  ["locale", "locale"], ["usage", "usage"], ["sensitivity", "sensitivity"],
  ["ignorePunctuation", "ignore_punctuation"], ["collation", "collation"],
  ["numeric", "numeric"], ["caseFirst", "case_first"],
]);

export function mojoIntlSourceProfileProperty(
  owner: string, member: string, receiver: MojoTargetTypeRef,
): MojoSourceProfilePropertyAccessPolicy | undefined {
  if (owner !== "IntlResolvedCollatorOptions" || receiver.kind !== "target-named" ||
    receiver.id !== "tsonic.mojo.js.IntlResolvedCollatorOptions") return undefined;
  const name = collatorProperties.get(member);
  return name === undefined ? undefined : Object.freeze({
    read: Object.freeze({ kind: "method", name: `get_${name}` }),
    write: Object.freeze({ kind: "method", name: `set_${name}` }),
    raises: false,
  });
}
