import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoBindingPatternSelection,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoObjectLiteralSelection,
  MojoProgramQueries,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";

export interface MojoProgramQueryIndexes {
  readonly sourceNavigation: TargetPlanningSourceNavigation;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly conversions: MojoConversionIndex;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly typeTestSelections: WeakMap<Node, MojoTypeTestSelection>;
  readonly elementSelections: WeakMap<Node, MojoElementSelection>;
  readonly iterationSelections: WeakMap<Node, MojoIterationSelection>;
  readonly resourceManagementSelections: WeakMap<Node, MojoResourceManagementSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly bindingPatternSelections: WeakMap<Node, MojoBindingPatternSelection>;
  readonly moduleBySourceFile: WeakMap<SourceFile, MojoAnalyzedModule>;
  readonly moduleBindingByDeclaration: WeakMap<Node, MojoAnalyzedModuleBinding>;
  readonly locationStorageNames: WeakMap<Node, string>;
}

export function createMojoProgramQueries(
  indexes: MojoProgramQueryIndexes,
): MojoProgramQueries {
  return Object.freeze({
    bindingName(referenceOrDeclaration: Node): string | undefined {
      return indexes.bindingNames.get(referenceOrDeclaration);
    },
    bindingSourceFile(referenceOrDeclaration: Node): SourceFile | undefined {
      return indexes.bindingSourceFiles.get(referenceOrDeclaration);
    },
    bindingType(declaration: Node): MojoTargetTypeRef | undefined {
      return indexes.bindingTypes.get(declaration);
    },
    expressionType(expression: Node): MojoTargetTypeRef | undefined {
      return indexes.expressionTypes.get(expression);
    },
    expressionConversion(expression: Node, expectedType: MojoTargetTypeRef) {
      return indexes.conversions.get(expression, expectedType);
    },
    callSelection(call: Node): MojoCallSelection | undefined {
      return indexes.callSelections.get(call);
    },
    propertySelection(access: Node): MojoPropertySelection | undefined {
      return indexes.propertySelections.get(access);
    },
    valueSelection(expression: Node): MojoValueSelection | undefined {
      return indexes.valueSelections.get(expression);
    },
    valueRefinement(expression: Node): MojoValueRefinementSelection | undefined {
      return indexes.valueRefinements.get(expression);
    },
    typeTestSelection(expression: Node): MojoTypeTestSelection | undefined {
      return indexes.typeTestSelections.get(expression);
    },
    elementSelection(access: Node): MojoElementSelection | undefined {
      return indexes.elementSelections.get(access);
    },
    iterationSelection(statement: Node): MojoIterationSelection | undefined {
      return indexes.iterationSelections.get(statement);
    },
    resourceManagementSelection(declaration: Node): MojoResourceManagementSelection | undefined {
      return indexes.resourceManagementSelections.get(declaration);
    },
    objectLiteralSelection(expression: Node): MojoObjectLiteralSelection | undefined {
      return indexes.objectLiteralSelections.get(expression);
    },
    callableExpressionSelection(expression: Node): MojoCallableExpressionSelection | undefined {
      return indexes.callableExpressionSelections.get(expression);
    },
    bindingPatternSelection(declaration: Node): MojoBindingPatternSelection | undefined {
      return indexes.bindingPatternSelections.get(declaration);
    },
    moduleForSourceFile(sourceFile: SourceFile) {
      return indexes.moduleBySourceFile.get(sourceFile);
    },
    moduleBinding(referenceOrDeclaration: Node) {
      const direct = indexes.moduleBindingByDeclaration.get(referenceOrDeclaration);
      if (direct !== undefined) return direct;
      const reference = indexes.sourceNavigation.sourceReferenceFor(referenceOrDeclaration);
      return reference === undefined
        ? undefined
        : indexes.moduleBindingByDeclaration.get(reference.declaration);
    },
    locationStorage(referenceOrDeclaration: Node) {
      const reference = indexes.sourceNavigation.sourceReferenceFor(referenceOrDeclaration);
      const declaration = reference?.project === true
        ? reference.declaration
        : referenceOrDeclaration;
      const name = indexes.locationStorageNames.get(declaration);
      const valueType = indexes.bindingTypes.get(declaration);
      return name === undefined || valueType === undefined
        ? undefined
        : Object.freeze({ declaration, name, valueType });
    },
  });
}
