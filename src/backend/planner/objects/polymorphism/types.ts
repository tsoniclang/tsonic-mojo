import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
} from "../../../../analysis/program/model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../../../target-model/types/model.js";

export const mojoProjectObjectType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "tsonic.mojo.runtime.ProjectObject",
  modulePath: Object.freeze(["tsonic_runtime"]),
  name: "ProjectObject",
});

export function mojoProjectStateType(
  declaration: MojoAnalyzedClass | MojoAnalyzedInterface,
  instance: MojoTargetTypeRef = declaration.targetType,
): MojoTargetTypeRef | undefined {
  if (declaration.targetType.kind !== "target-named" ||
    instance.kind !== "target-named" ||
    declaration.targetType.id !== instance.id) return undefined;
  const genericArguments: readonly MojoTargetGenericArgument[] = instance.genericArguments ?? [];
  return Object.freeze({
    kind: "target-named",
    id: `${declaration.targetType.id}:state`,
    modulePath: declaration.targetType.modulePath,
    name: declaration.stateName,
    ...(genericArguments.length === 0 ? {} : { genericArguments }),
  });
}

export function mojoProjectStaticMember(
  owner: MojoTargetTypeRef,
  name: string,
): import("../../../target-ast/index.js").MojoExpression {
  return Object.freeze({
    kind: "member",
    receiver: Object.freeze({ kind: "type-value", type: owner }),
    name,
  });
}

export function mojoProjectObjectState(
  object: import("../../../target-ast/index.js").MojoExpression,
  stateType: MojoTargetTypeRef,
): import("../../../target-ast/index.js").MojoExpression {
  return Object.freeze({
    kind: "method-call",
    receiver: object,
    name: "state",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: stateType })]),
    arguments: Object.freeze([]),
  });
}

export function mojoMemberPath(
  root: import("../../../target-ast/index.js").MojoExpression,
  path: readonly string[],
): import("../../../target-ast/index.js").MojoExpression {
  return path.reduce<import("../../../target-ast/index.js").MojoExpression>(
    (receiver, name) => Object.freeze({ kind: "member", receiver, name }),
    root,
  );
}
