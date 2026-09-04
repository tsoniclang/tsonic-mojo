import type { Node, SourceFile } from "@tsonic/tsts";
import { CatchClause_VariableDeclaration } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoBindingProjection } from "../bindings/patterns.js";
import { classifyMojoValueRefinement } from "../refinements/value.js";
import { walkSourceTreePostOrder } from "../../source/syntax/traversal.js";
import {
  analyzeReferencedValueRefinement,
  analyzeTypeTest,
  selectedOperationReceiverType,
} from "./executable-region-carriers.js";
import {
  descendWithinExecutableRegion,
  resolveExecutableRegionType as resolveType,
} from "./executable-region-support.js";
import { publishBindingPatternCarriers } from "./executable-region-flow.js";
import type {
  MojoBindingProjectionPlan,
} from "./model.js";
import type {
  MojoExecutableRegionAnalysisEnvironment,
  MojoExecutableRegionAnalysisInput,
} from "./executable-regions.js";

export function analyzeMojoExecutableBindingProjection(
  declaration: Node,
  sourceType: MojoTargetTypeRef,
  sourceSemanticType: import("@tsonic/tsts").Type | undefined,
  sourceFile: SourceFile,
  input: MojoExecutableRegionAnalysisEnvironment,
): MojoBindingProjectionPlan | undefined {
  const { ast } = input.source;
  const pattern = ast.name(declaration);
  if (pattern === undefined || (!ast.is.IsArrayBindingPattern(pattern) &&
    !ast.is.IsObjectBindingPattern(pattern))) return undefined;
  const semantics = input.source.semantics.forFile(sourceFile);
  const executableInput: MojoExecutableRegionAnalysisInput = {
    ...input,
    root: declaration,
    sourceFile,
  };
  const projection = analyzeMojoBindingProjection({
    ast,
    declaration,
    pattern,
    sourceType,
    sourceSemanticType,
    semantics,
    resolveType(type) {
      return resolveType(type, undefined, executableInput, semantics);
    },
    expressionTypes: input.expressionTypes,
    conversions: input.conversions,
    bindingNames: input.bindingNames,
    bindingTypes: input.bindingTypes,
    classByTypeId: input.classByTypeId,
    interfaceByTypeId: input.interfaceByTypeId,
    projectRelationships: input.projectRelationships,
    structuralObjects: input.structuralObjects,
    diagnostics: input.diagnostics,
  });
  if (projection === undefined) return undefined;
  input.bindingTypes.set(declaration, sourceType);
  input.bindingProjections.set(declaration, projection);
  publishBindingPatternCarriers(projection.elements, input);
  return projection;
}

export function sealMojoCatchBindingCarrier(
  catchClause: Node,
  catchBlock: Node,
  errorType: MojoTargetTypeRef,
  input: MojoExecutableRegionAnalysisEnvironment,
): void {
  const declaration = CatchClause_VariableDeclaration(input.source.ast, catchClause);
  if (declaration === undefined) return;
  const sourceFile = input.source.ast.getSourceFile(catchClause);
  if (sourceFile === undefined) return;
  input.bindingTypes.set(declaration, errorType);
  input.bindingSourceFiles.set(declaration, sourceFile);
  const semantics = input.source.semantics.forFile(sourceFile);
  for (const use of input.source.navigation.declarationUses(declaration)) {
    if (use.kind === "type-only" || use.kind === "source-linkage") continue;
    input.valueRefinements.delete(use.reference);
    const environment = { ...input, root: catchBlock, sourceFile };
    const selectedReceiverType = selectedOperationReceiverType(use.reference, input);
    const exactRefinement = selectedReceiverType === undefined
      ? undefined
      : classifyMojoValueRefinement(
          errorType,
          selectedReceiverType,
          input.projectRelationships,
          input.modules,
        );
    if (exactRefinement !== undefined) {
      input.valueRefinements.set(use.reference, exactRefinement);
    }
    const refined = exactRefinement?.resultType ?? analyzeReferencedValueRefinement(
      use.reference,
      errorType,
      environment,
      semantics,
    );
    input.expressionTypes.set(use.reference, refined ?? errorType);
  }
  walkSourceTreePostOrder(catchBlock, input.source.ast, (node): void => {
    if (input.source.ast.is.IsBinaryExpression(node) &&
      input.source.ast.operatorKindName(node) === "KindInstanceOfKeyword") {
      analyzeTypeTest(node, { ...input, root: catchBlock, sourceFile });
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, input.source.ast));
}
