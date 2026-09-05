import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoArrayLiteralSelection,
  MojoBindingPatternSelection,
  MojoBindingProjectionPlan,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoIntrinsicExpressionSelection,
  MojoNullishCoalescingSelection,
  MojoObjectLiteralSelection,
  MojoProgramQueries,
  MojoPropertySelection,
  MojoProjectStateProjection,
  MojoResourceManagementSelection,
  MojoTemplateExpressionSelection,
  MojoTypeTestSelection,
  MojoValueSelection,
} from "./model.js";

export interface MojoProgramQueryIndexes {
  readonly sourceNavigation: TargetPlanningSourceNavigation;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly conversions: MojoConversionIndex;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
  readonly intrinsicExpressionSelections: WeakMap<Node, MojoIntrinsicExpressionSelection>;
  readonly typeTestSelections: WeakMap<Node, MojoTypeTestSelection>;
  readonly nullishCoalescingSelections: WeakMap<Node, MojoNullishCoalescingSelection>;
  readonly elementSelections: WeakMap<Node, MojoElementSelection>;
  readonly iterationSelections: WeakMap<Node, MojoIterationSelection>;
  readonly resourceManagementSelections: WeakMap<Node, MojoResourceManagementSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly arrayLiteralSelections: WeakMap<Node, MojoArrayLiteralSelection>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly templateExpressionSelections: WeakMap<Node, MojoTemplateExpressionSelection>;
  readonly bindingPatternSelections: WeakMap<Node, MojoBindingPatternSelection>;
  readonly bindingProjections: WeakMap<Node, MojoBindingProjectionPlan>;
  readonly exitValueTransfers: WeakSet<Node>;
  readonly catchErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly moduleBySourceFile: WeakMap<SourceFile, MojoAnalyzedModule>;
  readonly moduleById: ReadonlyMap<string, MojoAnalyzedModule>;
  readonly moduleBindingByDeclaration: WeakMap<Node, MojoAnalyzedModuleBinding>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly stateDeclarationsById: ReadonlyMap<
    string,
    MojoAnalyzedClass | MojoAnalyzedInterface
  >;
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
    expressionErrorType(expression: Node): MojoTargetTypeRef | undefined {
      return indexes.expressionErrorTypes.get(expression);
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
    intrinsicExpressionSelection(expression: Node): MojoIntrinsicExpressionSelection | undefined {
      return indexes.intrinsicExpressionSelections.get(expression);
    },
    typeTestSelection(expression: Node): MojoTypeTestSelection | undefined {
      return indexes.typeTestSelections.get(expression);
    },
    nullishCoalescingSelection(expression: Node): MojoNullishCoalescingSelection | undefined {
      return indexes.nullishCoalescingSelections.get(expression);
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
    arrayLiteralSelection(expression: Node): MojoArrayLiteralSelection | undefined {
      return indexes.arrayLiteralSelections.get(expression);
    },
    callableExpressionSelection(expression: Node): MojoCallableExpressionSelection | undefined {
      return indexes.callableExpressionSelections.get(expression);
    },
    templateExpressionSelection(expression: Node): MojoTemplateExpressionSelection | undefined {
      return indexes.templateExpressionSelections.get(expression);
    },
    bindingPatternSelection(declaration: Node): MojoBindingPatternSelection | undefined {
      return indexes.bindingPatternSelections.get(declaration);
    },
    bindingProjection(declaration: Node): MojoBindingProjectionPlan | undefined {
      return indexes.bindingProjections.get(declaration);
    },
    exitValueTransfer(expression: Node): boolean {
      return indexes.exitValueTransfers.has(expression);
    },
    catchErrorType(catchClause: Node): MojoTargetTypeRef | undefined {
      return indexes.catchErrorTypes.get(catchClause);
    },
    moduleForSourceFile(sourceFile: SourceFile) {
      return indexes.moduleBySourceFile.get(sourceFile);
    },
    moduleForId(id: string) {
      return indexes.moduleById.get(id);
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
    projectState(type: MojoTargetTypeRef): MojoProjectStateProjection | undefined {
      const instance = type.kind === "optional" ? type.value : type;
      if (instance.kind !== "target-named") return undefined;
      const declaration = indexes.stateDeclarationsById.get(instance.id);
      if (declaration === undefined) return undefined;
      return Object.freeze({
        storage: declaration.stateStorage,
        stateType: Object.freeze({
          kind: "target-named" as const,
          id: `${instance.id}:state`,
          modulePath: instance.modulePath,
          name: declaration.stateName,
          ...((instance.genericArguments?.length ?? 0) === 0
            ? {}
            : { genericArguments: instance.genericArguments }),
        }),
      });
    },
  });
}
