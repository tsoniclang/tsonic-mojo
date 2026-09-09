import type { MojoJsValueProjection } from "../../../../target-model/conversions/js-value-graph.js";
import type { MojoTargetGenericArgument } from "../../../../target-model/types/model.js";
import { mojoTargetTypeInContext } from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";

export function sourceValueProjectionInContext(
  projection: MojoJsValueProjection,
  context: MojoPlanningContext,
): MojoJsValueProjection {
  const sourceType = mojoTargetTypeInContext(projection.sourceType, context);
  const genericParameters = Object.freeze(projection.genericParameters.flatMap((parameter) => {
    const type = mojoTargetTypeInContext({ kind: "type-parameter", name: parameter.name, identity: parameter.identity }, context);
    return type.kind !== "type-parameter" ? [] : [Object.freeze({
      ...parameter, name: type.name, identity: type.identity ?? parameter.identity,
      constraints: Object.freeze(parameter.constraints.map((constraint) => mojoTargetTypeInContext(constraint, context))),
    })];
  }));
  if (projection.kind === "union") return Object.freeze({
    ...projection, sourceType, genericParameters,
    members: Object.freeze(projection.members.map((member) => Object.freeze({
      ...member, sourceType: mojoTargetTypeInContext(member.sourceType, context),
    }))),
  });
  if (projection.kind === "object" && projection.toJson !== undefined) return Object.freeze({
    ...projection, sourceType, genericParameters, toJson: Object.freeze({
      ...projection.toJson, resultType: mojoTargetTypeInContext(projection.toJson.resultType, context),
    }),
  });
  return Object.freeze({ ...projection, sourceType, genericParameters });
}

export function sourceValueGenericArguments(projection: MojoJsValueProjection): readonly MojoTargetGenericArgument[] {
  return Object.freeze(projection.genericParameters.map((parameter) => Object.freeze({
    kind: "type", type: Object.freeze({ kind: "type-parameter", identity: parameter.identity, name: parameter.name }),
  })));
}
