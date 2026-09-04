import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoIteration } from "../operations/iterations.js";
import { analyzeMojoResourceManagement } from "../resources/management.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { mojoOperationErrorTypes } from "./effects.js";
import { resolveExecutableRegionType as resolveType } from "./executable-region-support.js";
import { analyzeMojoExecutableBindingProjection } from "./executable-region-bindings.js";
import type { MojoExecutableRegionAnalysisInput } from "./executable-regions.js";

export function analyzeMojoIterationAndResources(options: {
  readonly iterationNodes: readonly Node[];
  readonly resourceDeclarations: readonly Node[];
  readonly dependencies: Set<Node>;
  readonly semantics: ReturnType<MojoExecutableRegionAnalysisInput["source"]["semantics"]["forFile"]>;
  readonly input: MojoExecutableRegionAnalysisInput;
}): readonly MojoTargetTypeRef[] {
  const {
    iterationNodes,
    resourceDeclarations,
    dependencies,
    semantics,
    input,
  } = options;
  const { ast } = input.source;
for (const node of iterationNodes) {
    const selected = semantics.operations.iteration(node);
    const iterable = Node_Expression(ast, node);
    if (selected === undefined || iterable === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_ITERATION_EVIDENCE_MISSING",
        "Iteration lowering requires one exact checker-selected iteration operation.",
        node,
      ));
      continue;
    }
    const iteration = analyzeMojoIteration({
      ast,
      statement: node,
      iterable,
      source: selected,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      resolveType(type) {
        return resolveType(type, undefined, input, semantics);
      },
      sourceTypesIdentical(left, right) {
        return semantics.types.isIdentical(left, right);
      },
      analyzeBindingProjection(declaration, sourceType, sourceSemanticType) {
        return analyzeMojoExecutableBindingProjection(
          declaration,
          sourceType,
          sourceSemanticType,
          input.sourceFile,
          input,
        );
      },
    });
    if (iteration.kind === "unsupported") {
      input.diagnostics.push(diagnostic(iteration.code, iteration.reason, node));
    } else {
      input.iterationSelections.set(node, iteration.selection);
    }
  }
  const resourceErrorTypes: MojoTargetTypeRef[] = [];
  for (const declaration of resourceDeclarations) {
    const sourceInfo = semantics.operations.resourceManagement(declaration);
    if (sourceInfo === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_RESOURCE_MANAGEMENT_EVIDENCE_MISSING",
        "Resource lowering requires one exact checker-selected disposal operation.",
        declaration,
      ));
      continue;
    }
    const resource = analyzeMojoResourceManagement({
      declaration,
      source: input.source,
      sourceInfo,
      providerSemantics: input.providerSemantics,
      callableByDeclaration: input.callableByDeclaration,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      resolveType(type) {
        return resolveType(type, undefined, input, semantics);
      },
    });
    if (resource.kind === "unsupported") {
      input.diagnostics.push(diagnostic(resource.code, resource.reason, declaration));
      continue;
    }
    input.resourceManagementSelections.set(declaration, resource.selection);
    for (const alternative of resource.selection.alternatives) {
      if (alternative.disposal.kind === "project") {
        dependencies.add(alternative.disposal.dependency);
      } else {
        resourceErrorTypes.push(...mojoOperationErrorTypes(alternative.disposal.operation));
      }
    }
  }
  return resourceErrorTypes;
}

