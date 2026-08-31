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
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import { createMojoNameAllocator } from "../names/identifiers.js";
import { selectMojoProviderCall } from "../operations/provider-selection.js";
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
  MojoAnalyzedParameter,
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
    const semantics = input.source.semantics.forFile(draft.sourceFile);
    const callableType = semantics.declarations.declaredValueType(draft.declaration);
    const callable = callableType === undefined ? undefined : semantics.types.callable(callableType);
    if (callable === undefined) {
      diagnostics.push(diagnostic(
        "MOJO_FUNCTION_SIGNATURE_NOT_PROVEN",
        "The TypeScript checker supplied no exact callable signature for this function.",
        draft.declaration,
      ));
      continue;
    }
    const sourceParameters = ast.parameters(draft.declaration);
    if (sourceParameters.length !== callable.parameters.length ||
      sourceParameters.some((parameter) => parameter === undefined)) {
      diagnostics.push(diagnostic(
        "MOJO_FUNCTION_PARAMETER_EVIDENCE_MISMATCH",
        "Function syntax and selected checker parameter evidence do not align exactly.",
        draft.declaration,
      ));
      continue;
    }
    const parameters: MojoAnalyzedParameter[] = [];
    for (const [index, parameter] of (sourceParameters as readonly Node[]).entries()) {
      const nameNode = ast.name(parameter);
      const selected = callable.parameters[index];
      if (nameNode === undefined || !ast.is.IsIdentifier(nameNode) || selected === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_PARAMETER_SHAPE_UNSUPPORTED",
          "Mojo foundation requires simple named parameters with exact checker-selected types.",
          parameter,
        ));
        continue;
      }
      const typeResolution = resolveMojoTargetType(
        selected.type,
        ast.typeNode(parameter),
        { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
      );
      if (typeResolution.kind === "unsupported") {
        diagnostics.push(typeDiagnostic(parameter, typeResolution.reason));
        continue;
      }
      const name = draft.localNames(ast.text(nameNode));
      bindingNames.set(parameter, name);
      bindingTypes.set(parameter, typeResolution.type);
      parameters.push(Object.freeze({
        declaration: parameter,
        name,
        type: typeResolution.type,
      }));
    }
    const resultResolution = resolveMojoTargetType(
      callable.result.selectedType,
      callable.result.authoredTypeNode ?? ast.typeNode(draft.declaration),
      { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
    );
    if (resultResolution.kind === "unsupported") {
      diagnostics.push(typeDiagnostic(draft.declaration, resultResolution.reason));
      continue;
    }
    const function_: MojoAnalyzedFunction = {
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      parameters: Object.freeze(parameters),
      resultType: resultResolution.type,
      body: draft.body,
      raises: false,
    };
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
      const callee = Node_Expression(ast, node);
      const projectDeclaration = callee === undefined
        ? undefined
        : input.source.navigation.sourceReferenceFor(callee)?.declaration;
      const projectFunction = projectDeclaration === undefined
        ? undefined
        : functionByDeclaration.get(projectDeclaration);
      if (projectFunction !== undefined) {
        dependencies.add(projectFunction.declaration);
        callSelections.set(node, Object.freeze({
          kind: "project",
          functionName: projectFunction.name,
          parameterTypes: Object.freeze(projectFunction.parameters.map((entry) => entry.type)),
          resultType: projectFunction.resultType,
        }));
        return;
      }
      const provider = selectMojoProviderCall(input.source, selectedCall, providerSemantics);
      if (provider.kind !== "selected") {
        diagnostics.push(diagnostic(
          provider.kind === "ambiguous"
            ? "MOJO_PROVIDER_CALL_AMBIGUOUS"
            : "MOJO_CALL_TARGET_UNSUPPORTED",
          provider.kind === "ambiguous"
            ? `Selected provider call matches ${provider.count} Mojo operations.`
            : provider.reason,
          node,
        ));
        return;
      }
      const arguments_ = ast.arguments(node);
      const target = provider.operation.target;
      if (target.kind !== "function-call" && target.kind !== "instance-call") {
        diagnostics.push(diagnostic(
          "MOJO_PROVIDER_CALL_FORM_INVALID",
          `Selected provider call maps to non-call target form '${target.kind}'.`,
          node,
        ));
        return;
      }
      if (arguments_.some((argument) => argument === undefined) ||
        arguments_.length !== (provider.operation.parameterTypes ?? []).length ||
        arguments_.length !== target.arguments.length) {
        diagnostics.push(diagnostic(
          "MOJO_PROVIDER_CALL_ABI_MISMATCH",
          "Selected provider call arguments do not align with its closed Mojo ABI row.",
          node,
        ));
        return;
      }
      const receiver = selectedCall.sourceReceiver?.expression;
      callSelections.set(node, Object.freeze({
        kind: "provider",
        operation: provider.operation,
        arguments: Object.freeze(arguments_ as readonly Node[]),
        ...(receiver === undefined ? {} : { receiver }),
      }));
    });
    walkSourceTreePostOrder(function_.body, ast, (node): void => {
      if (!isMojoExpressionNode(node, ast)) return;
      const inferred = inferMojoExpressionType(node, ast, expressionTypes);
      if (inferred !== undefined) expressionTypes.set(node, inferred);
    });
    let functionRaises = false;
    walkSourceTree(function_.body, ast, (node): void => {
      if (!ast.is.IsCallExpression(node)) return;
      const selection = callSelections.get(node);
      if (selection?.kind !== "provider") return;
      functionRaises = functionRaises || selection.operation.raises === true ||
        providerCallRequiresRaisingConversion(selection, expressionTypes);
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
    callSelection(call: Node): MojoCallSelection | undefined {
      return callSelections.get(call);
    },
  });
  return resolvedTargetStage(Object.freeze({
    configuration,
    source: targetSourceSyntaxProgram(input.source),
    projectTypes,
    functions: Object.freeze(finalizedFunctions),
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
