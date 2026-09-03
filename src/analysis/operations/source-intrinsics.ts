import {
  argumentPassingFactKey,
  flowStateFactKey,
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  ResolvedSourceCallInfo,
  Type,
} from "@tsonic/tsts";
import { tsonicCompileTimeFactKey } from "@tsonic/source-core/facts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoSourceValueOperationFactKey } from "../../source/semantics/facts/operations.js";
import { resolveMojoValueGenericArgument } from "../../policy/types/generic-arguments.js";
import {
  classifyMojoSourceGenericParameter,
  mojoSourceGenericParameterOwner,
} from "../../source/semantics/generic-parameters.js";
import type { MojoCallSelection } from "../program/call-model.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";

export type MojoSourceIntrinsicAnalysis =
  | { readonly kind: "not-source-intrinsic" }
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoSourceIntrinsicAnalysisInput {
  readonly call: Node;
  readonly sourceCall: ResolvedSourceCallInfo;
  readonly source: TargetSourceProgram;
  readonly lifecycle: MojoLifecycleResolver;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly resolveType: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined;
}

export function analyzeMojoSourceIntrinsic(
  input: MojoSourceIntrinsicAnalysisInput,
): MojoSourceIntrinsicAnalysis {
  const compileTime = input.source.sourceFacts.getFact(input.call, tsonicCompileTimeFactKey);
  if (compileTime !== undefined) return analyzeCompileTimeIntrinsic(input, compileTime);

  const valueOperation = input.source.sourceFacts.getFact(
    input.call,
    mojoSourceValueOperationFactKey,
  );
  if (valueOperation !== undefined) {
    const operand = exactUnaryOperand(input, valueOperation.expression);
    if (operand === undefined) {
      return unsupported(
        "MOJO_SOURCE_VALUE_OPERATION_EVIDENCE_CONFLICT",
        `The exact ${valueOperation.kind} fact does not match the selected source argument.`,
      );
    }
    const resultType = closeIdentityResult(
      valueOperation.sourceType,
      valueOperation.resultType,
      operand,
      input,
    );
    if (resultType === undefined) {
      return unsupported(
        "MOJO_SOURCE_VALUE_OPERATION_CARRIER_UNCLOSED",
        `The exact ${valueOperation.kind} operation has no single Mojo input/result carrier.`,
      );
    }
    if (valueOperation.kind === "copy" &&
      input.lifecycle.capabilities(resultType).copy === "unavailable") {
      return unsupported(
        "MOJO_EXPLICIT_COPY_NOT_AVAILABLE",
        "The exact Mojo carrier does not implement the Copyable contract required by copy(...).",
      );
    }
    return {
          kind: "resolved",
          selection: Object.freeze({
            kind: "source-intrinsic",
            operation: valueOperation.kind,
            operand,
            resultType,
          }),
        };
  }

  const marker = input.source.sourceFacts.getFact(input.call, sourceMarkerFactKey);
  if (marker?.kind === "call-marker" && marker.marker === "js-string") {
    const argument = input.sourceCall.sourceArguments[0];
    const sourceType = argument === undefined
      ? undefined
      : input.resolveType(argument.type, argument.authoredTypeNode);
    const resultType = input.resolveType(input.sourceCall.sourceResultType);
    return input.sourceCall.sourceArguments.length !== 1 || argument === undefined ||
        sourceType?.kind !== "native-string" || !isJsString(resultType)
      ? unsupported(
          "MOJO_JS_STRING_CONVERSION_EVIDENCE_CONFLICT",
          "The exact jsstr operation does not close from one native String into JsString.",
        )
      : {
          kind: "resolved",
          selection: Object.freeze({
            kind: "source-intrinsic",
            operation: "js-string",
            operand: argument.expression,
            resultType,
          }),
        };
  }
  const ownership = exactOwnershipOperation(input);
  if (ownership === undefined) {
    return { kind: "not-source-intrinsic" };
  }
  const argument = input.sourceCall.sourceArguments[0];
  if (input.sourceCall.sourceArguments.length !== 1 || argument === undefined ||
    ownership.operand !== argument.expression) {
    return unsupported(
      "MOJO_SOURCE_OWNERSHIP_EVIDENCE_CONFLICT",
      `The exact ${ownership.operation} fact does not have one matching source argument.`,
    );
  }
  const resultType = closeIdentityResult(
    argument.type,
    input.sourceCall.sourceResultType,
    argument.expression,
    input,
  );
  if (resultType === undefined) {
    return unsupported(
      "MOJO_SOURCE_OWNERSHIP_CARRIER_UNCLOSED",
      `The exact ${ownership.operation} operation has no single Mojo input/result carrier.`,
    );
  }
  if (ownership.operation === "move" && !input.lifecycle.capabilities(resultType).movable) {
    return unsupported(
      "MOJO_EXPLICIT_MOVE_NOT_AVAILABLE",
      "The exact Mojo carrier is not movable and cannot satisfy move(...).",
    );
  }
  return {
        kind: "resolved",
        selection: Object.freeze({
          kind: "source-intrinsic",
          operation: ownership.operation,
          operand: argument.expression,
          resultType,
        }),
      };
}

function isJsString(
  type: MojoTargetTypeRef | undefined,
): type is Extract<MojoTargetTypeRef, { readonly kind: "target-named" }> {
  return type?.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

function analyzeCompileTimeIntrinsic(
  input: MojoSourceIntrinsicAnalysisInput,
  fact: import("@tsonic/source-core/facts").TsonicCompileTimeFact,
): MojoSourceIntrinsicAnalysis {
  if (fact.kind === "type") {
    const value = compileTimeTypeValue(fact, input);
    const resultType = input.resolveType(fact.resultType, fact.explicitTypeNode);
    return value === undefined || resultType === undefined
      ? unsupported(
          "MOJO_COMPTIME_TYPE_VALUE_UNCLOSED",
          "comptime<T>() requires one exact Mojo type, value parameter, or literal value.",
        )
      : {
          kind: "resolved",
          selection: Object.freeze({
            kind: "source-intrinsic",
            operation: "comptime-type",
            value,
            resultType,
          }),
        };
  }
  const operand = fact.kind === "value"
    ? fact.expression
    : fact.kind === "condition"
      ? fact.condition
      : fact.iterable;
  const exact = exactUnaryOperand(input, operand);
  if (exact === undefined) {
    return unsupported(
      "MOJO_COMPTIME_EVIDENCE_CONFLICT",
      `The exact compile-time ${fact.kind} fact does not match the selected source argument.`,
    );
  }
  const resultType = closeIdentityResult(fact.sourceType, fact.resultType, exact, input);
  return resultType === undefined
    ? unsupported(
        "MOJO_COMPTIME_CARRIER_UNCLOSED",
        `The exact compile-time ${fact.kind} operation has no single Mojo input/result carrier.`,
      )
    : {
        kind: "resolved",
        selection: Object.freeze({
          kind: "source-intrinsic",
          operation: fact.kind === "value" ? "comptime-value" : `comptime-${fact.kind}`,
          operand: exact,
          resultType,
        }),
      };
}

function compileTimeTypeValue(
  fact: Extract<import("@tsonic/source-core/facts").TsonicCompileTimeFact, { readonly kind: "type" }>,
  input: MojoSourceIntrinsicAnalysisInput,
): MojoTargetGenericArgument | undefined {
  const explicit = fact.explicitTypeNode;
  if (explicit !== undefined) {
    const semantics = input.source.semantics.forNode(input.call);
    const literal = resolveMojoValueGenericArgument(explicit, {
      ast: input.source.ast,
      semantics,
      sourceFacts: input.source.sourceFacts,
    });
    if (literal !== undefined) return literal;
  }
  const semantics = input.source.semantics.forNode(input.call);
  const symbol = semantics.declarations.typeAliasSymbol(fact.selectedType) ??
    semantics.declarations.typeSymbol(fact.selectedType);
  const declarations = symbol === undefined
    ? Object.freeze([])
    : semantics.declarations.symbolDeclarations(symbol);
  if (declarations.length === 1 && input.source.ast.is.IsTypeParameterDeclaration(declarations[0])) {
    const declaration = declarations[0]!;
    const owner = mojoSourceGenericParameterOwner(declaration, { ast: input.source.ast });
    const classified = owner === undefined
      ? undefined
      : classifyMojoSourceGenericParameter(owner, declaration, {
          ast: input.source.ast,
          semantics,
          sourceFacts: input.source.sourceFacts,
        });
    if (classified?.kind === "resolved" && classified.parameter.kind === "value") {
      return Object.freeze({
        kind: "value-reference",
        path: Object.freeze([classified.parameter.name]),
      });
    }
    if (classified?.kind === "resolved" && classified.parameter.kind === "origin") {
      return Object.freeze({
        kind: "origin",
        origin: Object.freeze({ kind: "parameter", name: classified.parameter.name }),
      });
    }
  }
  const target = input.resolveType(fact.selectedType, explicit);
  return target === undefined ? undefined : Object.freeze({ kind: "type", type: target });
}

function exactUnaryOperand(
  input: MojoSourceIntrinsicAnalysisInput,
  expected: Node,
): Node | undefined {
  const argument = input.sourceCall.sourceArguments[0];
  return input.sourceCall.sourceArguments.length === 1 && argument?.expression === expected
    ? expected
    : undefined;
}

function closeIdentityResult(
  sourceType: Type,
  resultSourceType: Type,
  operand: Node,
  input: MojoSourceIntrinsicAnalysisInput,
): MojoTargetTypeRef | undefined {
  const source = input.resolveType(sourceType, input.sourceCall.sourceArguments.find(
    (argument) => argument.expression === operand,
  )?.authoredTypeNode);
  const result = input.resolveType(resultSourceType);
  return source !== undefined && result !== undefined && mojoTargetTypeEquals(source, result)
    ? input.expressionTypes.get(operand) ?? result
    : undefined;
}

type OwnershipOperation =
  | "write-only-reference"
  | "read-write-reference"
  | "read-only-reference"
  | "shared-borrow"
  | "mutable-borrow"
  | "move";

function exactOwnershipOperation(
  input: MojoSourceIntrinsicAnalysisInput,
): { readonly operation: OwnershipOperation; readonly operand: Node } | undefined {
  const argument = input.sourceCall.sourceArguments[0]?.expression;
  if (argument === undefined) return undefined;
  const flow = input.source.sourceFacts.getFact(input.call, flowStateFactKey);
  if (flow !== undefined) {
    const argumentFlow = input.source.sourceFacts.getFact(argument, flowStateFactKey);
    if (argumentFlow?.state !== flow.state) return undefined;
    const operation = flow.state === "moved"
      ? "move" as const
      : flow.state === "borrowed-shared"
        ? "shared-borrow" as const
        : flow.state === "borrowed-mut"
          ? "mutable-borrow" as const
          : undefined;
    return operation === undefined ? undefined : Object.freeze({ operation, operand: argument });
  }
  const passing = input.source.sourceFacts.getFact(input.call, argumentPassingFactKey);
  if (passing?.storageExpression !== argument ||
    input.source.sourceFacts.getFact(argument, argumentPassingFactKey)?.mode !== passing.mode) {
    return undefined;
  }
  const operation = passing.mode === "byref-writeonly-must-init"
    ? "write-only-reference" as const
    : passing.mode === "byref-readwrite"
      ? "read-write-reference" as const
      : passing.mode === "byref-readonly"
        ? "read-only-reference" as const
        : undefined;
  return operation === undefined ? undefined : Object.freeze({ operation, operand: argument });
}

function unsupported(code: string, reason: string): MojoSourceIntrinsicAnalysis {
  return { kind: "unsupported", code, reason };
}
