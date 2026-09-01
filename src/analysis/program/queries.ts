import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type { MojoConversionIndex } from "../conversions/classification.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
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
  MojoValueSelection,
} from "./model.js";

export interface MojoProgramQueryIndexes {
  readonly source: TargetCompileInput["source"];
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly conversions: MojoConversionIndex;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
  readonly elementSelections: WeakMap<Node, MojoElementSelection>;
  readonly iterationSelections: WeakMap<Node, MojoIterationSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly bindingPatternSelections: WeakMap<Node, MojoBindingPatternSelection>;
  readonly moduleBySourceFile: WeakMap<SourceFile, MojoAnalyzedModule>;
  readonly moduleBindingByDeclaration: WeakMap<Node, MojoAnalyzedModuleBinding>;
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
    elementSelection(access: Node): MojoElementSelection | undefined {
      return indexes.elementSelections.get(access);
    },
    iterationSelection(statement: Node): MojoIterationSelection | undefined {
      return indexes.iterationSelections.get(statement);
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
      const reference = indexes.source.navigation.sourceReferenceFor(referenceOrDeclaration);
      return reference === undefined
        ? undefined
        : indexes.moduleBindingByDeclaration.get(reference.declaration);
    },
  });
}
