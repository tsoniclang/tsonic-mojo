import { rawPointerOperationFactKey } from "@tsonic/tsts";
import type {
  Node,
  RawPointerOperationFact,
  ResolvedSourceCallInfo,
  Type,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoCallSelection } from "../../analysis/program/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoRawPointerAnalysis =
  | { readonly kind: "not-raw-pointer" }
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoRawPointerAnalysisInput {
  readonly call: Node;
  readonly sourceCall: ResolvedSourceCallInfo;
  readonly source: TargetSourceProgram;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly resolveType: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined;
}

export function analyzeMojoRawPointer(
  input: MojoRawPointerAnalysisInput,
): MojoRawPointerAnalysis {
  const fact = input.source.sourceFacts.getFact(input.call, rawPointerOperationFactKey);
  if (fact === undefined) return { kind: "not-raw-pointer" };
  if (fact.call !== input.call || !argumentsMatch(input.sourceCall, fact)) {
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
    case "bind-raw-pointer": {
      const identityType = input.resolveType(fact.identityType);
      const definition = identityType?.kind === "target-named"
        ? input.projectTypes.definitionForId(identityType.id)
        : undefined;
      if (identityType === undefined || definition === undefined || definition.kind === "enum") {
        return unsupported(
          "MOJO_RAW_POINTER_IDENTITY_NOT_REPRESENTABLE",
          "Raw-pointer binding requires one exact project reference object with stable shared storage identity.",
        );
      }
      return resolved({
        kind: "raw-pointer",
        operation: "bind",
        identityExpression: fact.identityExpression,
        identityType,
        resultType,
      });
    }
    case "equal-raw-pointer": {
      const leftType = input.resolveType(fact.leftType);
      const rightType = input.resolveType(fact.rightType);
      if (leftType === undefined || rightType === undefined) {
        return unsupported(
          "MOJO_RAW_POINTER_OPERAND_NOT_CLOSED",
          "Raw-pointer equality requires exact closed operand carriers.",
        );
      }
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
      const pointerType = input.resolveType(fact.pointerType);
      if (pointerType === undefined) {
        return unsupported(
          "MOJO_RAW_POINTER_OPERAND_NOT_CLOSED",
          "Raw-pointer hashing requires one exact closed operand carrier.",
        );
      }
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

function argumentsMatch(
  call: ResolvedSourceCallInfo,
  fact: RawPointerOperationFact,
): boolean {
  const actual = call.sourceArguments.map((argument) => argument.expression);
  const expected = fact.operation === "bind-raw-pointer"
    ? [fact.identityExpression]
    : fact.operation === "equal-raw-pointer"
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
