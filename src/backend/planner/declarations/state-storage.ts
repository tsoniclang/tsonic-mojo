import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoProjectStateProjection } from "../../../analysis/program/model.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function mojoStateStorageType(
  stateType: MojoTargetTypeRef,
  storage: "direct" | "erased",
): MojoTargetTypeRef {
  return storage === "direct"
    ? Object.freeze({
        kind: "target-named",
        id: "mojo.std.memory.ArcPointer",
        modulePath: Object.freeze(["std", "memory"]),
        name: "ArcPointer",
        genericArguments: Object.freeze([{ kind: "type" as const, type: stateType }]),
      })
    : Object.freeze({
        kind: "target-named",
        id: "tsonic.mojo.runtime.SharedReference",
        modulePath: Object.freeze(["tsonic_runtime"]),
        name: "SharedReference",
      });
}

export function mojoStateValue(
  receiver: MojoExpression,
  state: MojoProjectStateProjection,
): MojoExpression {
  const storage: MojoExpression = Object.freeze({
    kind: "member",
    receiver,
    name: "_state",
  });
  return state.storage === "direct"
    ? Object.freeze({ kind: "postfix-deref", expression: storage })
    : Object.freeze({
        kind: "method-call",
        receiver: storage,
        name: "state",
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type: state.stateType })]),
        arguments: Object.freeze([]),
      });
}

export function mojoProjectStateValue(
  receiver: MojoExpression,
  receiverType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const state = context.program.queries.projectState(receiverType);
  if (state === undefined) return undefined;
  registerMojoTypeImports(state.stateType, context);
  return mojoStateValue(receiver, state);
}
