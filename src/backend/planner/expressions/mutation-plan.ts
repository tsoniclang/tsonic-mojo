import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export type MojoMutationValuePassing = "borrow" | "assign" | "consume";

export interface MojoPreparedMutation {
  readonly before: readonly MojoStatement[];
  readonly assignedValue: MojoExpression;
  readonly assignedType: MojoTargetTypeRef;
  readonly previousValue?: MojoExpression;
  readonly createWrite: (value: MojoExpression) => MojoStatement;
  readonly createDiscardWrite?: () => MojoStatement;
  readonly valuePassing: MojoMutationValuePassing;
}

export interface MojoPlannedMutation {
  readonly before: readonly MojoStatement[];
  readonly statement: MojoStatement;
  readonly result?: MojoExpression;
}

export function materializeMojoMutation(
  prepared: MojoPreparedMutation,
  result: "discard" | "assigned" | "previous",
  resultType: MojoTargetTypeRef | undefined,
  sourceNode: Node,
  context: MojoPlanningContext,
): MojoPlannedMutation | undefined {
  if (result === "discard") {
    return Object.freeze({
      before: prepared.before,
      statement: prepared.createDiscardWrite?.() ?? prepared.createWrite(prepared.assignedValue),
    });
  }
  if (resultType === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_MUTATION_RESULT_CARRIER_MISSING",
      "A value-producing mutation requires one exact sealed result carrier.",
      sourceNode,
    );
    return undefined;
  }
  if (result === "previous") {
    if (prepared.previousValue === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_MUTATION_PREVIOUS_VALUE_MISSING",
        "A postfix update requires one exact stabilized previous value.",
        sourceNode,
      );
      return undefined;
    }
    if (!mojoTargetTypeEquals(prepared.assignedType, resultType)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_MUTATION_RESULT_CARRIER_CONFLICT",
        "The exact mutation result carrier differs from the selected target location carrier.",
        sourceNode,
      );
      return undefined;
    }
    return Object.freeze({
      before: prepared.before,
      statement: prepared.createWrite(prepared.assignedValue),
      result: prepared.previousValue,
    });
  }
  if (!mojoTargetTypeEquals(prepared.assignedType, resultType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_MUTATION_RESULT_CARRIER_CONFLICT",
      "The exact mutation result carrier differs from the selected target write carrier.",
      sourceNode,
    );
    return undefined;
  }
  registerMojoTypeImports(resultType, context);
  const name = allocateMojoSyntheticName(context, "mutation_result");
  const path: MojoExpression = Object.freeze({ kind: "path", path: name });
  const writeValue = retainedMutationValue(
    path,
    prepared.assignedType,
    prepared.valuePassing,
    sourceNode,
    context,
  );
  if (writeValue === undefined) return undefined;
  return Object.freeze({
    before: Object.freeze([
      ...prepared.before,
      Object.freeze({
        kind: "variable" as const,
        name,
        type: resultType,
        initializer: prepared.assignedValue,
      }),
    ]),
    statement: prepared.createWrite(writeValue),
    result: path,
  });
}

export function mutationAsValue(
  mutation: MojoPlannedMutation,
): MojoValuePlan | undefined {
  return mutation.result === undefined
    ? undefined
    : withMojoValue([...mutation.before, mutation.statement], mutation.result);
}

function retainedMutationValue(
  value: MojoExpression,
  type: MojoTargetTypeRef,
  passing: MojoMutationValuePassing,
  sourceNode: Node,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (passing === "borrow") return value;
  const copy = context.program.lifecycle.capabilities(type).copy;
  if (copy === "implicit") return value;
  if (copy === "explicit") {
    return Object.freeze({ kind: "copy", expression: value });
  }
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_MUTATION_RESULT_COPY_UNAVAILABLE",
    "A value-producing mutation cannot both store and retain this non-copyable Mojo carrier.",
    sourceNode,
  );
  return undefined;
}
