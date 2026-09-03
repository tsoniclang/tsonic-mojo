import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import {
  classifyMojoValueConversion,
} from "../../policy/conversions/selection.js";
import type {
  MojoConversionClassification,
} from "../../policy/conversions/selection.js";
import type { MojoValueConversionNarrowing } from "../../target-model/conversions/model.js";
import type { MojoValueRefinementSelection } from "./model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";

export function classifyMojoValueRefinement(
  sourceType: MojoTargetTypeRef,
  resultType: MojoTargetTypeRef,
  projectRelationships?: MojoProjectTypeRelationships,
  modules?: MojoSourceModuleCatalog,
): MojoValueRefinementSelection | undefined {
  if (sourceType.kind === "optional" &&
    mojoTargetTypeEquals(sourceType.value, resultType)) {
    return Object.freeze({ kind: "optional-present", sourceType, resultType });
  }
  if (sourceType.kind === "union" &&
    sourceType.members.some((member) => mojoTargetTypeEquals(member, resultType))) {
    return Object.freeze({ kind: "union-member", sourceType, resultType });
  }
  if (sourceType.kind === "union" && resultType.kind === "union" &&
    resultType.members.length > 0 && resultType.members.every((member) =>
      sourceType.members.some((sourceMember) => mojoTargetTypeEquals(sourceMember, member)))) {
    return Object.freeze({ kind: "union-subset", sourceType, resultType });
  }
  const dispatchType = sourceType.kind === "optional" ? sourceType.value : sourceType;
  const sourceDefinition = projectRelationships?.definitionForType(dispatchType);
  const targetDefinition = projectRelationships?.definitionForType(resultType);
  const sourceComponent = modules?.forSourceFile(sourceDefinition?.sourceFile)?.componentId;
  const targetComponent = modules?.forSourceFile(targetDefinition?.sourceFile)?.componentId;
  const relationship = sourceDefinition === undefined || targetDefinition === undefined ||
      targetDefinition.kind !== "class" || targetDefinition.typeParameters.length !== 0 ||
      sourceComponent === undefined || sourceComponent !== targetComponent
    ? undefined
    : projectRelationships!.relationship(resultType, sourceDefinition);
  if (relationship?.kind === "related" &&
    mojoTargetTypeEquals(relationship.targetType, dispatchType)) {
    return Object.freeze({
      kind: "project-downcast",
      sourceType,
      dispatchType,
      resultType,
    });
  }
  return undefined;
}

export function mojoValueConversionNarrowing(
  refinement: MojoValueRefinementSelection | undefined,
): MojoValueConversionNarrowing | undefined {
  return refinement?.kind === "union-subset"
    ? Object.freeze({
        sourceType: refinement.sourceType,
        selectedType: refinement.resultType,
      })
    : undefined;
}

export function classifyMojoRefinedValueConversion(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
  refinement: MojoValueRefinementSelection | undefined,
  projectRelationships?: MojoProjectTypeRelationships,
): MojoConversionClassification {
  return classifyMojoValueConversion(
    actual,
    expected,
    mojoValueConversionNarrowing(refinement),
    projectRelationships,
  );
}
