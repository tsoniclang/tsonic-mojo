import { rawPointerOperationFactKey } from "@tsonic/tsts";
import type {
  Node,
  RawPointerOperationFact,
  ResolvedSourceCallInfo,
  Type,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoCallSelection } from "../program/model.js";
import {
  fixedMojoLifecycleContract,
  mojoExplicitLifecycleCapabilities,
} from "../../target-model/lifecycle/index.js";

const rawPointerLifecycle = fixedMojoLifecycleContract(mojoExplicitLifecycleCapabilities);
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoRawPointerAnalysis =
  | { readonly kind: "not-raw-pointer" }
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoRawPointerAnalysisInput {
  readonly call: Node;
  readonly sourceCall: ResolvedSourceCallInfo;
  readonly source: TargetSourceProgram;
  readonly resolveType: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined;
}

export function analyzeMojoRawPointer(
  input: MojoRawPointerAnalysisInput,
): MojoRawPointerAnalysis {
  const fact = input.source.sourceFacts.getFact(input.call, rawPointerOperationFactKey);
  if (fact === undefined) return { kind: "not-raw-pointer" };
  if (fact.call !== input.call || fact.operation === "bind-raw-pointer" ||
    !argumentsMatch(input.sourceCall, fact)) {
    return unsupported(
      "MOJO_RAW_POINTER_EVIDENCE_CONFLICT",
      "The exact selected arguments do not match the finalized raw-pointer operation fact.",
    );
  }
  const resultType = input.resolveType(fact.resultType);
  if (resultType === undefined) {
    return unsupported(
      "MOJO_RAW_POINTER_RESULT_NOT_CLOSED",
      "The finalized raw-pointer operation has no exact Mojo result carrier.",
    );
  }
  switch (fact.operation) {
    case "equal-raw-pointer": {
      const leftType = optionalRawPointerType();
      const rightType = optionalRawPointerType();
      return resolved({
        kind: "raw-pointer",
        operation: "equal",
        leftExpression: fact.leftExpression,
        leftType,
        rightExpression: fact.rightExpression,
        rightType,
        resultType,
      });
    }
    case "hash-raw-pointer": {
      const pointerType = optionalRawPointerType();
      return resolved({
        kind: "raw-pointer",
        operation: "hash",
        pointerExpression: fact.pointerExpression,
        pointerType,
        resultType,
      });
    }
  }
}

export function mojoRawPointerTargetType(): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.RawPointer",
    modulePath: Object.freeze(["tsonic_runtime"]),
    name: "RawPointer",
    lifecycle: rawPointerLifecycle,
  });
}

function optionalRawPointerType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value: mojoRawPointerTargetType() });
}

function argumentsMatch(
  call: ResolvedSourceCallInfo,
  fact: Exclude<RawPointerOperationFact, { readonly operation: "bind-raw-pointer" }>,
): boolean {
  const actual = call.sourceArguments.map((argument) => argument.expression);
  const expected = fact.operation === "equal-raw-pointer"
      ? [fact.leftExpression, fact.rightExpression]
      : [fact.pointerExpression];
  return actual.length === expected.length &&
    actual.every((argument, index) => argument === expected[index]);
}

function resolved(
  selection: Extract<MojoCallSelection, { readonly kind: "raw-pointer" }>,
): MojoRawPointerAnalysis {
  return { kind: "resolved", selection: Object.freeze(selection) };
}

function unsupported(code: string, reason: string): MojoRawPointerAnalysis {
  return { kind: "unsupported", code, reason };
}
