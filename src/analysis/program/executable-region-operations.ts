import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoCall } from "../operations/calls.js";
import { mojoCallResultType } from "../operations/call-results.js";
import { analyzeMojoElementAccess } from "../operations/elements.js";
import { analyzeMojoProjectProperty } from "../operations/project-fields.js";
import { analyzeMojoProviderProperty } from "../operations/properties.js";
import { analyzeMojoStructuralProperty } from "../operations/structural-fields.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { resolveExecutableRegionType as resolveType } from "./executable-region-support.js";
import type { MojoExecutableRegionAnalysisInput } from "./executable-regions.js";

export function analyzeCall(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  dependencies: Set<Node>,
): void {
  const selectedCall = semantics.operations.call(node);
  if (selectedCall === undefined || selectedCall.sourceSelectedSignatureKind !== "resolved") {
    input.diagnostics.push(diagnostic(
      "MOJO_CALL_EVIDENCE_MISSING",
      "Call lowering requires one exact checker-selected signature.",
      node,
    ));
    return;
  }
  const analyzed = analyzeMojoCall(node, selectedCall, {
    source: input.source,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    projectRelationships: input.projectRelationships,
    lifecycle: input.lifecycle,
    valueOwnership: input.valueOwnership,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
    expressionTypes: input.expressionTypes,
    valueRefinements: input.valueRefinements,
    conversions: input.conversions,
    callableByDeclaration: input.callableByDeclaration,
    classByDeclaration: input.classByDeclaration,
    classByTypeId: input.classByTypeId,
    locationStorageNames: input.locationStorageNames,
    modulePathForSourceFile(owner) {
      return input.modules.forSourceFile(owner)?.modulePath ?? Object.freeze([]);
    },
  });
  if (analyzed.kind === "unsupported") {
    input.diagnostics.push(diagnostic(analyzed.code, analyzed.reason, node));
    return;
  }
  if (analyzed.dependency !== undefined) dependencies.add(analyzed.dependency);
  if (analyzed.dependency !== undefined) input.callDependencies.set(node, analyzed.dependency);
  input.callSelections.set(node, analyzed.selection);
  input.callNodes.add(node);
  input.expressionTypes.set(node, mojoCallResultType(analyzed.selection));
}

export function analyzeProperty(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): void {
  const selected = semantics.operations.propertyAccess(node);
  if (selected === undefined) {
    input.diagnostics.push(diagnostic(
      "MOJO_PROPERTY_EVIDENCE_MISSING",
      "Property lowering requires one exact checker-selected access.",
      node,
    ));
    return;
  }
  const resolve = (type: Type): MojoTargetTypeRef | undefined => resolveType(type, undefined, input, semantics);
  const selectedReceiverType = resolve(selected.receiver.type);
  const exactReceiverType = input.expressionTypes.get(selected.receiver.expression) ??
    selectedReceiverType;
  const projectReceiverType = reconcileProjectReceiverType(
    exactReceiverType,
    selectedReceiverType,
  );
  const structural = analyzeMojoStructuralProperty({
    source: selected,
    receiverType: exactReceiverType,
    structuralObjects: input.structuralObjects,
    semantics,
  });
  const project = structural.kind === "not-structural-field"
      ? analyzeMojoProjectProperty(
        selected,
        input.fieldByDeclaration,
        input.callableByDeclaration,
        projectReceiverType,
        Object.freeze([
          ...semantics.facts.selectedSubjects(selected.selectedSymbol, selected.selectedDeclaration),
          ...semantics.facts.selectedSubjects(selected.sourceSymbol, selected.sourceDeclaration),
        ]),
        input.source.ast,
        input.projectRelationships,
        resolve,
      )
    : structural;
  const property = project.kind === "not-project-field"
    ? analyzeMojoProviderProperty(selected, {
        source: input.source,
        providerSemantics: input.providerSemantics,
        sourceProfiles: input.sourceProfiles,
        conversions: input.conversions,
        valueRefinements: input.valueRefinements,
        resolveType: resolve,
      })
    : project;
  if (property.kind === "unsupported") {
    input.diagnostics.push(diagnostic(property.code, property.reason, node));
  } else if (property.kind === "resolved") {
    input.propertySelections.set(node, property.selection);
    input.propertyNodes.add(node);
    input.expressionTypes.set(node, property.expressionType);
  }
}

function reconcileProjectReceiverType(
  exactType: MojoTargetTypeRef | undefined,
  selectedType: MojoTargetTypeRef | undefined,
): MojoTargetTypeRef | undefined {
  if (exactType?.kind === "target-named" && selectedType?.kind === "target-named" &&
    exactType.id === selectedType.id) return exactType;
  return selectedType ?? exactType;
}

export function analyzeElement(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): void {
  const selected = semantics.operations.elementAccess(node);
  if (selected === undefined) {
    input.diagnostics.push(diagnostic(
      "MOJO_ELEMENT_EVIDENCE_MISSING",
      "Element lowering requires one exact checker-selected access.",
      node,
    ));
    return;
  }
  const element = analyzeMojoElementAccess(selected, {
    source: input.source,
    providerSemantics: input.providerSemantics,
    sourceProfiles: input.sourceProfiles,
    conversions: input.conversions,
    expressionTypes: input.expressionTypes,
    valueRefinements: input.valueRefinements,
    projectPropertyByDeclaration: input.fieldByDeclaration,
    projectRelationships: input.projectRelationships,
    resolveType(type) {
      return resolveType(type, undefined, input, semantics);
    },
  });
  if (element.kind === "unsupported") {
    input.diagnostics.push(diagnostic(element.code, element.reason, node));
  } else {
    input.elementSelections.set(node, element.selection);
    input.expressionTypes.set(node, element.expressionType);
    if (element.valueRefinement !== undefined) {
      input.valueRefinements.set(node, element.valueRefinement);
    }
  }
}
