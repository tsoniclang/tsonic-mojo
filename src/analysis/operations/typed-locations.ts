import { pointerOperationFactKey } from "@tsonic/tsts";
import type {
  Node,
  PointerOperationFact,
  ResolvedSourceCallInfo,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoCallSelection } from "../program/model.js";
import {
  fixedMojoLifecycleContract,
  mojoImplicitHeapLifecycleCapabilities,
} from "../../target-model/lifecycle/index.js";

const locationLifecycle = fixedMojoLifecycleContract(mojoImplicitHeapLifecycleCapabilities);

export type MojoTypedLocationAnalysis =
  | { readonly kind: "not-typed-location" }
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoTypedLocationAnalysisInput {
  readonly call: Node;
  readonly sourceCall: ResolvedSourceCallInfo;
  readonly source: TargetSourceProgram;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly resolveType: (
    type: import("@tsonic/tsts").Type,
    authoredTypeNode?: Node,
  ) => MojoTargetTypeRef | undefined;
}

export function mojoLocationTargetType(pointee: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.Location",
    modulePath: Object.freeze(["tsonic_runtime"]),
    name: "Location",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: pointee })]),
    lifecycle: locationLifecycle,
  });
}

export function analyzeMojoTypedLocation(
  input: MojoTypedLocationAnalysisInput,
): MojoTypedLocationAnalysis {
  const fact = input.source.sourceFacts.getFact(input.call, pointerOperationFactKey);
  if (fact === undefined) return { kind: "not-typed-location" };
  if (fact.call !== input.call) {
    return unsupported(
      "MOJO_POINTER_OPERATION_EVIDENCE_CONFLICT",
      "The finalized pointer-operation fact is not owned by this exact call occurrence.",
    );
  }
  if (!argumentsMatch(input.sourceCall, fact)) {
    return unsupported(
      "MOJO_POINTER_OPERATION_EVIDENCE_CONFLICT",
      `The selected '${fact.operation}' arguments do not match the finalized pointer-operation evidence.`,
    );
  }
  const exactLocation = exactLocationType(fact, input.expressionTypes);
  const exactPointee = exactOperationPointee(fact, exactLocation, input.expressionTypes);
  const resolvedPointee = input.resolveType(fact.pointeeType, fact.explicitPointeeTypeNode);
  const pointeeType = exactPointee ?? resolvedPointee;
  if (pointeeType === undefined) {
    return unsupported(
      "MOJO_POINTER_POINTEE_CARRIER_NOT_PROVEN",
      `The selected '${fact.operation}' operation has no exact Mojo pointee carrier.`,
    );
  }
  if (exactPointee !== undefined && fact.explicitPointeeTypeNode !== undefined &&
    (resolvedPointee === undefined || !mojoTargetTypeEquals(exactPointee, resolvedPointee))) {
    return unsupported(
      "MOJO_POINTER_POINTEE_CARRIER_CONFLICT",
      `The selected '${fact.operation}' pointer and authored pointee require different Mojo carriers.`,
    );
  }
  const locationType = exactLocation ?? mojoLocationTargetType(pointeeType);
  switch (fact.operation) {
    case "address-of": {
      const declaration = directStorageDeclaration(fact, input.source);
      if (declaration === undefined || input.locationStorageNames.get(declaration) === undefined) {
        return unsupported(
          "MOJO_POINTER_STORAGE_NOT_REPRESENTABLE",
          "Address-of requires one exact function-local identifier storage root promoted to a Mojo Location.",
        );
      }
      return resolved({
        kind: "typed-location",
        operation: "address-of",
        pointeeType,
        locationType,
        resultType: locationType,
        storageDeclaration: declaration,
      });
    }
    case "allocate":
      return resolved({
        kind: "typed-location",
        operation: "allocate",
        pointeeType,
        locationType,
        resultType: locationType,
        initialExpression: fact.initialExpression,
      });
    case "load":
      return resolved({
        kind: "typed-location",
        operation: "load",
        pointeeType,
        locationType,
        resultType: pointeeType,
        pointerExpression: fact.pointerExpression,
      });
    case "store":
      return resolved({
        kind: "typed-location",
        operation: "store",
        pointeeType,
        locationType,
        resultType: Object.freeze({ kind: "unit" }),
        pointerExpression: fact.pointerExpression,
        valueExpression: fact.valueExpression,
      });
    case "equal-pointer":
      return resolved({
        kind: "typed-location",
        operation: "equal-pointer",
        pointeeType,
        locationType,
        resultType: Object.freeze({ kind: "source-primitive", name: "bool" }),
        leftExpression: fact.leftExpression,
        rightExpression: fact.rightExpression,
      });
    case "hash-pointer":
    case "bind-pointer":
    case "project-pointer":
      return unsupported(
        "MOJO_TYPED_LOCATION_NATIVE_LIMIT",
        `The pinned Mojo runtime has no exact '${fact.operation}' identity contract.`,
      );
  }
}

function exactOperationPointee(
  fact: PointerOperationFact,
  exactLocation: MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  if (fact.operation === "address-of") return expressionTypes.get(fact.storageExpression);
  if (fact.operation === "allocate") return expressionTypes.get(fact.initialExpression);
  return locationPointee(exactLocation);
}

function exactLocationType(
  fact: PointerOperationFact,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  switch (fact.operation) {
    case "load":
    case "store":
    case "hash-pointer":
    case "project-pointer":
      return expressionTypes.get(fact.pointerExpression);
    case "bind-pointer":
      return undefined;
    case "equal-pointer": {
      const left = expressionTypes.get(fact.leftExpression);
      const right = expressionTypes.get(fact.rightExpression);
      return left !== undefined && right !== undefined && mojoTargetTypeEquals(left, right)
        ? left
        : undefined;
    }
    case "address-of":
    case "allocate":
      return undefined;
  }
}

function locationPointee(type: MojoTargetTypeRef | undefined): MojoTargetTypeRef | undefined {
  if (type?.kind !== "target-named" || type.id !== "tsonic.mojo.runtime.Location") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

function directStorageDeclaration(
  fact: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  source: TargetSourceProgram,
): Node | undefined {
  if (fact.storageDeclaration === undefined ||
    !source.ast.is.IsIdentifier(fact.storageExpression)) return undefined;
  const reference = source.navigation.sourceReferenceFor(fact.storageExpression);
  return reference?.project === true && reference.declaration === fact.storageDeclaration
    ? fact.storageDeclaration
    : undefined;
}

function argumentsMatch(
  call: ResolvedSourceCallInfo,
  fact: PointerOperationFact,
): boolean {
  const actual = call.sourceArguments.map((argument) => argument.expression);
  const expected = expectedArguments(fact);
  return actual.length === expected.length &&
    actual.every((argument, index) => argument === expected[index]);
}

function expectedArguments(fact: PointerOperationFact): readonly Node[] {
  switch (fact.operation) {
    case "address-of": return Object.freeze([fact.storageExpression]);
    case "allocate": return Object.freeze([fact.initialExpression]);
    case "load":
    case "hash-pointer": return Object.freeze([fact.pointerExpression]);
    case "store": return Object.freeze([fact.pointerExpression, fact.valueExpression]);
    case "equal-pointer": return Object.freeze([fact.leftExpression, fact.rightExpression]);
    case "bind-pointer": return Object.freeze([
      fact.identityExpression,
      fact.readExpression,
      fact.writeExpression,
    ]);
    case "project-pointer": return Object.freeze([
      fact.pointerExpression,
      fact.fromSourceExpression,
      fact.toSourceExpression,
    ]);
  }
}

function resolved(
  selection: Extract<MojoCallSelection, { readonly kind: "typed-location" }>,
): MojoTypedLocationAnalysis {
  return { kind: "resolved", selection: Object.freeze(selection) };
}

function unsupported(code: string, reason: string): MojoTypedLocationAnalysis {
  return { kind: "unsupported", code, reason };
}
