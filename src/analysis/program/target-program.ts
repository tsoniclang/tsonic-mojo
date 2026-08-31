import type { Node, SourceFile, Type } from "@tsonic/tsts";
import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import type {
  TargetDiagnostic,
  TargetStageResult,
} from "@tsonic/target-api/artifacts";
import {
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import {
  Node_Initializer,
} from "@tsonic/target-api/source";
import { createMojoNameAllocator } from "../names/identifiers.js";
import { analyzeMojoFunctionSignature } from "../callables/signatures.js";
import { createMojoConversionIndex } from "../conversions/classification.js";
import { recordMojoFunctionConversionUses } from "../conversions/uses.js";
import { analyzeMojoCall } from "../operations/calls.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import {
  resolveMojoTargetType,
} from "../types/resolution.js";
import { createMojoProjectTypeCatalog } from "../types/project-catalog.js";
import {
  providerCallRequiresRaisingConversion,
  propagateRaisingEffects,
} from "./effects.js";
import { inferMojoExpressionType, isMojoExpressionNode } from "./expression-types.js";
import type {
  MojoAnalyzedFunction,
  MojoCallSelection,
  MojoProgramQueries,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { validateMojoFunctionSyntax } from "./syntax-validation.js";
import { walkSourceTree, walkSourceTreePostOrder } from "./traversal.js";

export function analyzeMojoTargetProgram(
  request: MojoTargetAnalysisRequest,
): TargetStageResult<MojoTargetProgram> {
  const { input, configuration, providerSemantics, jsEnabled } = request;
  const { ast } = input.source;
  const sourceFiles = Object.freeze(input.source.sourceFiles.filter(
    (sourceFile): sourceFile is SourceFile =>
      sourceFile !== undefined &&
      !ast.isDeclarationFile(sourceFile),
  ));
  const diagnostics: TargetDiagnostic[] = [];
  const bindingNames = new WeakMap<Node, string>();
  const bindingTypes = new WeakMap<Node, MojoTargetTypeRef>();
  const expressionTypes = new WeakMap<Node, MojoTargetTypeRef>();
  const callSelections = new WeakMap<Node, MojoCallSelection>();
  const conversions = createMojoConversionIndex();
  const functionByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  const directRaises = new Map<Node, boolean>();
  const projectDependencies = new Map<Node, Set<Node>>();
  const globalNames = createMojoNameAllocator();
  const globalNameByDeclaration = new WeakMap<Node, string>();
  const functionDrafts: {
    readonly declaration: Node;
    readonly sourceFile: SourceFile;
    readonly name: string;
    readonly body: Node;
    readonly localNames: (sourceName: string) => string;
  }[] = [];

  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) continue;
      const nameNode = ast.name(statement);
      if (nameNode !== undefined && ast.is.IsIdentifier(nameNode)) {
        globalNameByDeclaration.set(statement, globalNames(ast.text(nameNode)));
      }
    }
  }
  const projectTypes = createMojoProjectTypeCatalog(
    input.source,
    sourceFiles,
    (declaration, sourceName) => globalNameByDeclaration.get(declaration) ?? globalNames(sourceName),
  );
  for (const issue of projectTypes.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }

  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined || ast.is.IsImportDeclaration(statement) ||
        ast.is.IsExportDeclaration(statement) || ast.is.IsTypeAliasDeclaration(statement) ||
        ast.is.IsInterfaceDeclaration(statement)) {
        continue;
      }
      if (!ast.is.IsFunctionDeclaration(statement)) {
        diagnostics.push(diagnostic(
          "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED",
          "Mojo foundation currently requires executable project declarations to be top-level functions.",
          statement,
        ));
        continue;
      }
      const nameNode = ast.name(statement);
      const body = ast.body(statement);
      if (nameNode === undefined || !ast.is.IsIdentifier(nameNode) || body === undefined || !ast.is.IsBlock(body)) {
        diagnostics.push(diagnostic(
          "MOJO_FUNCTION_SHAPE_UNSUPPORTED",
          "Mojo functions require a named TypeScript function declaration with a body.",
          statement,
        ));
        continue;
      }
      const name = globalNameByDeclaration.get(statement) ?? globalNames(ast.text(nameNode));
      bindingNames.set(statement, name);
      functionDrafts.push(Object.freeze({
        declaration: statement,
        sourceFile,
        name,
        body,
        localNames: createMojoNameAllocator(),
      }));
    }
  }

  const functions: MojoAnalyzedFunction[] = [];
  for (const draft of functionDrafts) {
    const function_ = analyzeMojoFunctionSignature({
      source: input.source,
      providerSemantics,
      projectTypes,
      jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      body: draft.body,
      allocateLocalName: draft.localNames,
      bindingNames,
      bindingTypes,
      diagnostics,
    });
    if (function_ === undefined) continue;
    functions.push(function_);
    functionByDeclaration.set(draft.declaration, function_);
    allocateLocalBindings(
      draft.body,
      draft.localNames,
      bindingNames,
      ast,
      diagnostics,
    );
  }

  for (const function_ of functions) {
    const semantics = input.source.semantics.forFile(function_.sourceFile);
    const dependencies = new Set<Node>();
    projectDependencies.set(function_.declaration, dependencies);
    walkSourceTree(function_.body, ast, (node): void => {
      if (ast.is.IsVariableDeclaration(node)) {
        const selected = declaredOrInitializerType(node, semantics, ast);
        const resolved = resolveMojoTargetType(
          selected,
          ast.typeNode(node),
          { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
        );
        if (resolved.kind === "unsupported") {
          diagnostics.push(typeDiagnostic(node, resolved.reason));
        } else {
          bindingTypes.set(node, resolved.type);
        }
      }
      if (isMojoExpressionNode(node, ast)) {
        const reference = ast.is.IsIdentifier(node)
          ? input.source.navigation.sourceReferenceFor(node)
          : undefined;
        const referencedName = reference === undefined
          ? undefined
          : bindingNames.get(reference.declaration);
        if (referencedName !== undefined) bindingNames.set(node, referencedName);
        const referencedType = reference === undefined
          ? undefined
          : bindingTypes.get(reference.declaration);
        const selectedType = semantics.types.expressionType(node);
        const resolved = referencedType === undefined
          ? resolveMojoTargetType(
              selectedType,
              undefined,
              { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
            )
          : { kind: "resolved" as const, type: referencedType };
        if (resolved.kind === "resolved") expressionTypes.set(node, resolved.type);
      }
      if (!ast.is.IsCallExpression(node)) return;
      const selectedCall = semantics.operations.call(node);
      if (selectedCall === undefined || selectedCall.sourceSelectedSignatureKind !== "resolved") {
        diagnostics.push(diagnostic(
          "MOJO_CALL_EVIDENCE_MISSING",
          "Call lowering requires one exact checker-selected signature.",
          node,
        ));
        return;
      }
      const analyzedCall = analyzeMojoCall(node, selectedCall, {
        source: input.source,
        providerSemantics,
        projectTypes,
        jsEnabled,
        expressionTypes,
        conversions,
        functionByDeclaration,
      });
      if (analyzedCall.kind === "unsupported") {
        diagnostics.push(diagnostic(analyzedCall.code, analyzedCall.reason, node));
        return;
      }
      if (analyzedCall.dependency !== undefined) dependencies.add(analyzedCall.dependency);
      callSelections.set(node, analyzedCall.selection);
    });
    walkSourceTreePostOrder(function_.body, ast, (node): void => {
      if (!isMojoExpressionNode(node, ast)) return;
      const inferred = inferMojoExpressionType(node, ast, expressionTypes);
      if (inferred !== undefined) expressionTypes.set(node, inferred);
    });
    recordMojoFunctionConversionUses(
      function_,
      ast,
      bindingTypes,
      expressionTypes,
      conversions,
      diagnostics,
    );
    let functionRaises = false;
    walkSourceTree(function_.body, ast, (node): void => {
      if (!ast.is.IsCallExpression(node)) return;
      const selection = callSelections.get(node);
      if (selection?.kind !== "provider") return;
      functionRaises = functionRaises || selection.operation.raises === true ||
        providerCallRequiresRaisingConversion(selection);
    });
    directRaises.set(function_.declaration, functionRaises);
  }

  const raisesByDeclaration = propagateRaisingEffects(
    functions,
    directRaises,
    projectDependencies,
  );
  const finalizedFunctions = functions.map((function_) => Object.freeze({
    ...function_,
    raises: raisesByDeclaration.get(function_.declaration) === true,
  }));

  for (const function_ of finalizedFunctions) {
    validateMojoFunctionSyntax(function_, ast, callSelections, bindingNames, diagnostics);
  }
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);

  const queries: MojoProgramQueries = Object.freeze({
    bindingName(referenceOrDeclaration: Node): string | undefined {
      return bindingNames.get(referenceOrDeclaration);
    },
    bindingType(declaration: Node): MojoTargetTypeRef | undefined {
      return bindingTypes.get(declaration);
    },
    expressionType(expression: Node): MojoTargetTypeRef | undefined {
      return expressionTypes.get(expression);
    },
    expressionConversion(expression: Node, expectedType: MojoTargetTypeRef) {
      return conversions.get(expression, expectedType);
    },
    callSelection(call: Node): MojoCallSelection | undefined {
      return callSelections.get(call);
    },
  });
  return resolvedTargetStage(Object.freeze({
    configuration,
    source: targetSourceSyntaxProgram(input.source),
    projectTypes,
    declarations: Object.freeze(finalizedFunctions),
    queries,
    runtimePackages: analyzeMojoRuntimePackages(input.runtimeReferences),
  }));
}

function allocateLocalBindings(
  body: Node,
  allocate: (name: string) => string,
  bindings: WeakMap<Node, string>,
  ast: import("@tsonic/tsts").AstReader,
  diagnostics: TargetDiagnostic[],
): void {
  walkSourceTree(body, ast, (node): void => {
    if (!ast.is.IsVariableDeclaration(node)) return;
    const nameNode = ast.name(node);
    if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
      diagnostics.push(diagnostic(
        "MOJO_BINDING_PATTERN_UNSUPPORTED",
        "Mojo foundation currently requires simple identifier variable bindings.",
        node,
      ));
      return;
    }
    bindings.set(node, allocate(ast.text(nameNode)));
  });
}

function declaredOrInitializerType(
  declaration: Node,
  semantics: import("@tsonic/target-api/source").SourceFileSemantics,
  ast: import("@tsonic/tsts").AstReader,
): Type | undefined {
  const authored = ast.typeNode(declaration);
  const initializer = Node_Initializer(ast, declaration);
  return semantics.declarations.declaredValueType(declaration) ??
    semantics.declarations.declaredType(declaration) ??
    (authored === undefined ? undefined : semantics.types.authoredType(authored)) ??
    (initializer === undefined ? undefined : semantics.types.expressionType(initializer));
}

function typeDiagnostic(node: Node, reason: string): TargetDiagnostic {
  return diagnostic(
    "MOJO_TARGET_TYPE_UNSUPPORTED",
    `Selected source type cannot be represented exactly in Mojo: ${reason}.`,
    node,
  );
}
