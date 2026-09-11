import { createTsonicMemoryMetadataIndex, createTsonicPointerBackingQueries, createTsonicClosedArrayStorageQueries } from "@tsonic/source-core/facts";
import { pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { walkSourceTree } from "../../source/syntax/traversal.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoNativeArrayType, mojoNativeArrayElement } from "../../target-model/types/native-arrays.js";
import { unwrapMojoStorageExpression } from "./locations.js";

export interface MojoMemoryAnalysis {
  readonly erasedSourceNodes: WeakSet<Node>;
  readonly backing: ReturnType<typeof createTsonicPointerBackingQueries>;
  readonly nativeArrayType: (node: Node, type: MojoTargetTypeRef) => MojoTargetTypeRef;
  readonly nativeArrayElement: (node: Node, expressionTypes: WeakMap<Node, MojoTargetTypeRef>) => boolean;
}

export function createMojoMemoryAnalysis(sourceFiles: readonly SourceFile[], source: TargetSourceProgram, diagnostics: TargetDiagnostic[]): MojoMemoryAnalysis {
  const metadata = createTsonicMemoryMetadataIndex(source);
  const erasedSourceNodes = new WeakSet<Node>();
  const arrayStorage = createTsonicClosedArrayStorageQueries(source, 131_072);
  const nativeArrayNodes = new WeakSet<Node>();
  const nativeArrayElements = new WeakMap<Node, Node>();
  const { ast } = source;
  for (const sourceFile of sourceFiles) {
    walkSourceTree(sourceFile, ast, (node) => {
      const pointer = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (pointer?.operation === "address-of" && pointer.call === node) {
        const storage = unwrapMojoStorageExpression(pointer.storageExpression, { source });
        if (ast.is.IsElementAccessExpression(storage)) {
          const closed = arrayStorage.resolve(storage);
          if (closed.kind === "closed") {
            for (const occurrence of [...closed.declarations, ...closed.references, ...closed.literals]) nativeArrayNodes.add(occurrence);
            for (const element of closed.elements) nativeArrayElements.set(element.expression, element.receiver.expression);
          }
        }
      }
      const declaration = ast.is.IsVariableDeclaration(node) ? metadata.declaration(node) : undefined;
      for (const issue of declaration?.issues ?? []) diagnostics.push(mojoAnalysisDiagnostic("MOJO_MEMORY_METADATA_RUNTIME_USE", issue.reason, issue.node));
      if (declaration !== undefined || metadata.isCompileTimeExpression(node)) {
        walkSourceTree(node, ast, (child) => erasedSourceNodes.add(child));
      }
    }, (node) => !erasedSourceNodes.has(node));
  }
  return Object.freeze({ erasedSourceNodes,
    nativeArrayType(node: Node, type: MojoTargetTypeRef) {
      const occurrence = unwrapMojoStorageExpression(node, { source });
      return nativeArrayNodes.has(occurrence) && type.kind === "list" ? mojoNativeArrayType(type.element) : type;
    },
    nativeArrayElement(node: Node, expressionTypes: WeakMap<Node, MojoTargetTypeRef>) {
      const receiver = nativeArrayElements.get(unwrapMojoStorageExpression(node, { source }));
      const type = receiver === undefined ? undefined : expressionTypes.get(receiver);
      return type !== undefined && mojoNativeArrayElement(type) !== undefined;
    },
    backing: createTsonicPointerBackingQueries(source, {
    maximumValues: 131_072,
    hasClosedCallers: (declaration) => ast.is.IsFunctionDeclaration(declaration) && !source.navigation.declarationUseSummary(declaration).exported,
  }) });
}
