import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/render.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function adaptMojoValueErrorDomain(
  plan: MojoValuePlan,
  resultType: MojoTargetTypeRef,
  sourceErrorType: MojoTargetTypeRef | undefined,
  targetErrorType: MojoTargetTypeRef | undefined,
  sourceNode: Node,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (sourceErrorType === undefined ||
    (targetErrorType !== undefined && mojoTargetTypeEquals(sourceErrorType, targetErrorType))) {
    return plan;
  }
  if (targetErrorType === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ERROR_DOMAIN_NOT_ADMITTED",
      "A raising operation appears in an executable region whose sealed Mojo error domain is empty.",
      sourceNode,
    );
    return undefined;
  }
  if (!errorDomainContains(targetErrorType, sourceErrorType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ERROR_DOMAIN_INCOMPATIBLE",
      "A raising operation's exact Mojo error domain is not contained by its executable region.",
      sourceNode,
    );
    return undefined;
  }
  registerMojoTypeImports(sourceErrorType, context);
  registerMojoTypeImports(targetErrorType, context);
  registerMojoTypeImports(resultType, context);
  const errorName = allocateMojoSyntheticName(context, "caught_error");
  const error = Object.freeze({ kind: "path" as const, path: errorName });
  const caught = Object.freeze({
    name: errorName,
    statements: rethrowInErrorDomain(error, sourceErrorType, targetErrorType),
  });
  if (resultType.kind === "unit") {
    return withMojoValue(Object.freeze([
      ...plan.before,
      Object.freeze({
        kind: "try" as const,
        statements: Object.freeze([Object.freeze({
          kind: "expression" as const,
          expression: plan.value,
        })]),
        catches: Object.freeze([caught]),
      }),
    ]), Object.freeze({ kind: "tuple", elements: Object.freeze([]) }));
  }
  const resultName = allocateMojoSyntheticName(context, "raising_result");
  const result = Object.freeze({ kind: "path" as const, path: resultName });
  return withMojoValue(Object.freeze([
    ...plan.before,
    Object.freeze({ kind: "variable" as const, name: resultName, type: resultType }),
    Object.freeze({
      kind: "try" as const,
      statements: Object.freeze([Object.freeze({
        kind: "assignment" as const,
        operator: "=" as const,
        left: result,
        right: plan.value,
      })]),
      catches: Object.freeze([caught]),
    }),
  ]), Object.freeze({ kind: "consume", expression: result }));
}

function errorDomainContains(
  target: MojoTargetTypeRef,
  source: MojoTargetTypeRef,
): boolean {
  const targetMembers = target.kind === "union" ? target.members : Object.freeze([target]);
  const sourceMembers = source.kind === "union" ? source.members : Object.freeze([source]);
  return sourceMembers.every((sourceMember) => targetMembers.some((targetMember) =>
    mojoTargetTypeEquals(sourceMember, targetMember)));
}

function rethrowInErrorDomain(
  error: MojoExpression,
  source: MojoTargetTypeRef,
  target: MojoTargetTypeRef,
): readonly MojoStatement[] {
  if (target.kind !== "union") {
    return Object.freeze([Object.freeze({ kind: "raise", expression: error })]);
  }
  if (source.kind !== "union") {
    return Object.freeze([Object.freeze({
      kind: "raise",
      expression: constructErrorDomain(target, error),
    })]);
  }
  const branch = (index: number): readonly MojoStatement[] => {
    const member = source.members[index]!;
    const raised = Object.freeze({
      kind: "raise" as const,
      expression: constructErrorDomain(target, Object.freeze({
        kind: "type-element" as const,
        receiver: error,
        type: member,
      })),
    });
    if (index === source.members.length - 1) return Object.freeze([raised]);
    return Object.freeze([Object.freeze({
      kind: "if" as const,
      condition: Object.freeze({
        kind: "method-call" as const,
        receiver: error,
        name: "isa",
        genericArguments: Object.freeze([Object.freeze({ kind: "type" as const, type: member })]),
        arguments: Object.freeze([]),
      }),
      thenStatements: Object.freeze([raised]),
      elseStatements: branch(index + 1),
    })]);
  };
  return branch(0);
}

function constructErrorDomain(
  target: Extract<MojoTargetTypeRef, { readonly kind: "union" }>,
  value: MojoExpression,
): MojoExpression {
  return Object.freeze({
    kind: "construct",
    type: target,
    arguments: Object.freeze([Object.freeze({ value })]),
  });
}
