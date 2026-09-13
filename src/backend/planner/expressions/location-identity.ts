import type { MojoLocationOwnerIdentity } from "../../../target-model/operations/typed-locations.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function planMojoLocationOwnerIdentity(owner: MojoExpression, type: MojoTargetTypeRef, identity: MojoLocationOwnerIdentity, context: MojoPlanningContext): MojoExpression | undefined {
  const identityType: MojoTargetTypeRef = Object.freeze({ kind: "target-named", id: "tsonic.mojo.runtime.LocationIdentity", modulePath: Object.freeze(["tsonic_runtime"]), name: "LocationIdentity" });
  registerMojoTypeImports(identityType, context);
  let reference: MojoExpression;
  if (identity === "project") {
    const state = context.program.queries.projectState(type);
    if (state === undefined) return undefined;
    if (state.storage !== "direct") return fromAddress(method(member(owner, "_state"), "identity_address"));
    reference = member(owner, "_state");
  } else if (identity === "project-polymorphic") return fromAddress(method(member(owner, "_object"), "identity_address"));
  else if (identity === "callable") reference = method(owner, "identity");
  else reference = member(owner, identity === "array" ? "_elements" : "_state");
  return Object.freeze({ kind: "call", callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "location_identity"), arguments: Object.freeze([{ value: reference }]) });

  function fromAddress(address: MojoExpression): MojoExpression {
    return Object.freeze({ kind: "construct", type: identityType, arguments: Object.freeze([
      { value: address }, { value: Object.freeze({ kind: "string-literal", value: "" }) },
    ]) });
  }
}

function member(receiver: MojoExpression, name: string): MojoExpression {
  return Object.freeze({ kind: "member", receiver, name });
}

function method(receiver: MojoExpression, name: string): MojoExpression {
  return Object.freeze({ kind: "method-call", receiver, name, arguments: Object.freeze([]) });
}
