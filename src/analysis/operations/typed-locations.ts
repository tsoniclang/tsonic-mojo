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
import { mojoTypedLocationType, mojoTypedLocationPointee } from "../../target-model/types/typed-locations.js";
import { mojoNativeErrorType } from "../../target-model/types/error-domains.js";
import type { MojoCallAnalysisContext } from "./calls.js";
import { analyzeMojoAddressedStorage, mojoLocationOwnerIdentity, mojoLocationOwnerIsInitializing, unwrapMojoStorageExpression } from "../storage/locations.js";

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
  readonly propertySelections: MojoCallAnalysisContext["propertySelections"];
  readonly elementSelections: MojoCallAnalysisContext["elementSelections"];
  readonly fieldByDeclaration: MojoCallAnalysisContext["fieldByDeclaration"];
  readonly projectRelationships: MojoCallAnalysisContext["projectRelationships"];
  readonly structuralObjects: MojoCallAnalysisContext["structuralObjects"];
  readonly contextualizeCallableArgument: MojoCallAnalysisContext["contextualizeCallableArgument"];
  readonly resolveType: (
    type: import("@tsonic/tsts").Type,
    authoredTypeNode?: Node,
  ) => MojoTargetTypeRef | undefined;
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
  if (!argumentsMatch(input.sourceCall, fact, input.source)) {
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
  const locationType = mojoTypedLocationType(pointeeType);
  switch (fact.operation) {
    case "address-of": {
      const storage = analyzeMojoAddressedStorage(fact, pointeeType, input);
      if (storage === undefined) {
        return unsupported(
          "MOJO_POINTER_STORAGE_NOT_REPRESENTABLE",
          "Address-of requires exact mutable storage with a retained owner and stable location identity; copied native values and accessor results are not storage owners.",
        );
      }
      return resolved({
        kind: "typed-location",
        operation: "address-of",
        pointeeType,
        locationType,
        resultType: locationType,
        storage,
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
        operandType: Object.freeze({
          kind: "optional",
          value: locationType,
        }),
        resultType: Object.freeze({ kind: "source-primitive", name: "bool" }),
        leftExpression: fact.leftExpression,
        rightExpression: fact.rightExpression,
      });
    case "hash-pointer":
      return resolved({
        kind: "typed-location", operation: "hash-pointer", pointeeType, locationType,
        resultType: Object.freeze({ kind: "source-primitive", name: "float64" }),
        operandType: Object.freeze({ kind: "optional", value: locationType }),
        pointerExpression: fact.pointerExpression,
      });
    case "bind-pointer": {
      if (mojoLocationOwnerIsInitializing(fact.identityExpression, input)) return unsupported(
        "MOJO_POINTER_OWNER_NOT_RETAINABLE", "A constructor state under initialization is not yet a retained project reference owner.",
      );
      const identityType = input.expressionTypes.get(fact.identityExpression) ?? input.resolveType(fact.identityType);
      const identity = identityType === undefined ? undefined : mojoLocationOwnerIdentity(identityType, input);
      if (identityType === undefined || identity === undefined) return unsupported(
        "MOJO_POINTER_IDENTITY_NOT_PROVEN", "Pointer binding requires one exact retained reference-owner identity.",
      );
      const readType = locationCallback([], pointeeType);
      const writeType = locationCallback([pointeeType], Object.freeze({ kind: "unit" }));
      input.contextualizeCallableArgument(fact.readExpression, readType);
      input.contextualizeCallableArgument(fact.writeExpression, writeType);
      return resolved({
        kind: "typed-location", operation: "bind-pointer", pointeeType, locationType, resultType: locationType,
        identityExpression: fact.identityExpression, identityType, identity,
        readExpression: fact.readExpression, readType,
        writeExpression: fact.writeExpression, writeType,
      });
    }
    case "project-pointer": {
      const sourcePointee = mojoTypedLocationPointee(exactLocation) ?? input.resolveType(fact.sourcePointeeType, fact.explicitSourcePointeeTypeNode);
      const declaredSource = input.resolveType(fact.sourcePointeeType, fact.explicitSourcePointeeTypeNode);
      if (sourcePointee === undefined || declaredSource === undefined || !mojoTargetTypeEquals(sourcePointee, declaredSource)) return unsupported(
        "MOJO_POINTER_POINTEE_CARRIER_CONFLICT", "Pointer projection has no exact agreeing source-pointee carrier.",
      );
      const types = input.source.semantics.forNode(input.call).types;
      const resultMembers = types.isUnion(fact.resultType) ? types.unionOrIntersectionTypes(fact.resultType) : [fact.resultType];
      const optional = resultMembers.some((type) => types.isNullish(type));
      const fromSourceType = locationCallback([sourcePointee], pointeeType);
      const toSourceType = locationCallback([pointeeType], sourcePointee);
      input.contextualizeCallableArgument(fact.fromSourceExpression, fromSourceType);
      input.contextualizeCallableArgument(fact.toSourceExpression, toSourceType);
      return resolved({
        kind: "typed-location", operation: "project-pointer", pointeeType, locationType,
        resultType: optional ? Object.freeze({ kind: "optional", value: locationType }) : locationType,
        sourceLocationType: optional ? Object.freeze({ kind: "optional", value: mojoTypedLocationType(sourcePointee) }) : mojoTypedLocationType(sourcePointee),
        optional, pointerExpression: fact.pointerExpression,
        fromSourceExpression: fact.fromSourceExpression, fromSourceType,
        toSourceExpression: fact.toSourceExpression, toSourceType,
      });
    }
  }
}

function exactOperationPointee(
  fact: PointerOperationFact,
  exactLocation: MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  if (fact.operation === "address-of") return expressionTypes.get(fact.storageExpression);
  if (fact.operation === "allocate") return fact.explicitPointeeTypeNode === undefined
    ? expressionTypes.get(fact.initialExpression) : undefined;
  if (fact.operation === "project-pointer") return undefined;
  return mojoTypedLocationPointee(exactLocation);
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
      const leftPointee = mojoTypedLocationPointee(left);
      const rightPointee = mojoTypedLocationPointee(right);
      return leftPointee !== undefined && rightPointee !== undefined && mojoTargetTypeEquals(leftPointee, rightPointee)
        ? mojoTypedLocationType(leftPointee) : undefined;
    }
    case "address-of":
    case "allocate":
      return undefined;
  }
}

function locationCallback(parameters: readonly MojoTargetTypeRef[], result: MojoTargetTypeRef): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> {
  return Object.freeze({ kind: "callable", parameters: Object.freeze(parameters.map((type) => Object.freeze({ convention: "imm", passing: "plain", type }))), result, raises: true, errorType: mojoNativeErrorType() });
}

function argumentsMatch(
  call: ResolvedSourceCallInfo,
  fact: PointerOperationFact,
  source: TargetSourceProgram,
): boolean {
  const actual = call.sourceArguments.map((argument) => argument.expression);
  const expected = expectedArguments(fact);
  return actual.length === expected.length &&
    actual.every((argument, index) => fact.operation === "address-of"
      ? unwrapMojoStorageExpression(argument, { source }) === expected[index]
      : argument === expected[index]);
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
