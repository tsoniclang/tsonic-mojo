import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export interface MojoSourceProfilePropertyAccessPolicy {
  readonly read: { readonly kind: "member" | "method"; readonly name: string };
  readonly write?: { readonly kind: "member" | "method"; readonly name: string };
  readonly raises: boolean;
}

const identity = jsRegExpSourceProfileIdentity;
const owners = identity.owners;
const members = identity.regExpMembers;
const results = identity.regExpResultMembers;

const regexpArrayIds = new Set([
  "tsonic.mojo.js.RegExpExecArray",
  "tsonic.mojo.js.RegExpMatchArray",
  "tsonic.mojo.js.RegExpIndicesArray",
  "tsonic.mojo.js.JsRegExpExecArray",
  "tsonic.mojo.js.JsRegExpMatchArray",
  "tsonic.mojo.js.JsRegExpIndicesArray",
]);

export function sourceProfileRegExpPropertyAccess(
  owner: string,
  member: string,
  receiver: MojoTargetTypeRef,
): MojoSourceProfilePropertyAccessPolicy | undefined {
  if ((owner === "Array" || owner === "ReadonlyArray") && member === "length" &&
    receiver.kind === "target-named" && regexpArrayIds.has(receiver.id)) {
    return method("js_length");
  }
  if (owner === owners.regExp) {
    switch (member) {
      case members.source: return method("source", true);
      case members.flags: return method("flags", true);
      case members.global: return method("global_", true);
      case members.ignoreCase: return method("ignore_case", true);
      case members.multiline: return method("multiline", true);
      case members.dotAll: return method("dot_all", true);
      case members.hasIndices: return method("has_indices", true);
      case members.sticky: return method("sticky", true);
      case members.unicode: return method("unicode", true);
      case members.unicodeSets: return method("unicode_sets", true);
      case members.lastIndex:
        return Object.freeze({
          read: Object.freeze({ kind: "method", name: "last_index" }),
          write: Object.freeze({ kind: "method", name: "set_last_index" }),
          raises: true,
        });
    }
  }
  if (owner === owners.regExpExecArray || owner === owners.jsRegExpExecArray ||
    owner === owners.regExpMatchArray || owner === owners.jsRegExpMatchArray) {
    switch (member) {
      case results.first: return method("first");
      case results.index: return method("index");
      case results.input: return method("input");
      case results.groups: return method("groups");
      case results.indices: return method("indices");
    }
  }
  if ((owner === owners.regExpIndicesArray || owner === owners.jsRegExpIndicesArray) &&
    member === results.groups) {
    return method("groups");
  }
  return undefined;
}

function method(
  name: string,
  raises = false,
): MojoSourceProfilePropertyAccessPolicy {
  return Object.freeze({
    read: Object.freeze({ kind: "method", name }),
    raises,
  });
}
