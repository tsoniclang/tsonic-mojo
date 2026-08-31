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
import { analyzeMojoFunctionSignature } from "../callables/signatures.js";
import { analyzeMojoClass } from "../declarations/classes.js";
import { createMojoConversionIndex } from "../conversions/classification.js";
import { recordMojoFunctionConversionUses } from "../conversions/uses.js";
import { analyzeMojoCall } from "../operations/calls.js";
import { analyzeMojoElementAccess } from "../operations/elements.js";
import { analyzeMojoIteration } from "../operations/iterations.js";
import {
  analyzeMojoProjectProperty,
  analyzeMojoProviderProperty,
} from "../operations/properties.js";
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
  MojoAnalyzedClass,
  MojoAnalyzedClassField,
  MojoAnalyzedDeclaration,
  MojoAnalyzedFunction,
  MojoCallSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoPropertySelection,
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
  const propertySelections = new WeakMap<Node, MojoPropertySelection>();
  const elementSelections = new WeakMap<Node, MojoElementSelection>();
  const iterationSelections = new WeakMap<Node, MojoIterationSelection>();
  const conversions = createMojoConversionIndex();
  const functionByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  const classByDeclaration = new WeakMap<Node, MojoAnalyzedClass>();
  const classByTypeId = new Map<string, MojoAnalyzedClass>();
  const fieldByDeclaration = new WeakMap<Node, MojoAnalyzedClassField>();
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
  const classDrafts: {
    readonly declaration: Node;
    readonly sourceFile: SourceFile;
    readonly name: string;
    readonly stateName: string;
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
      if (ast.is.IsClassDeclaration(statement)) {
        const nameNode = ast.name(statement);
        if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
          diagnostics.push(diagnostic(
            "MOJO_CLASS_SHAPE_UNSUPPORTED",
            "Mojo classes require one exact named class declaration.",
            statement,
          ));
          continue;
        }
        const name = globalNameByDeclaration.get(statement) ?? globalNames(ast.text(nameNode));
        bindingNames.set(statement, name);
        classDrafts.push(Object.freeze({
          declaration: statement,
          sourceFile,
          name,
          stateName: globalNames(`${name}State`),
        }));
        continue;
      }
      if (!ast.is.IsFunctionDeclaration(statement)) {
        diagnostics.push(diagnostic(
          "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED",
          "Executable project declarations require a supported top-level function or class form.",
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
  const classes: MojoAnalyzedClass[] = [];
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

  for (const draft of classDrafts) {
    const analyzed = analyzeMojoClass({
      source: input.source,
      providerSemantics,
      projectTypes,
      jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      stateName: draft.stateName,
      bindingNames,
      bindingTypes,
      diagnostics,
      allocateLocalBindings(body, allocate) {
        allocateLocalBindings(body, allocate, bindingNames, ast, diagnostics);
      },
    });
    if (analyzed === undefined) continue;
    classes.push(analyzed.class_);
    classByDeclaration.set(draft.declaration, analyzed.class_);
    if (analyzed.class_.targetType.kind === "target-named") {
      classByTypeId.set(analyzed.class_.targetType.id, analyzed.class_);
    }
    for (const field of analyzed.fields) fieldByDeclaration.set(field.declaration, field);
    for (const callable of analyzed.callables) {
      functions.push(callable);
      functionByDeclaration.set(callable.declaration, callable);
    }
  }

  for (const class_ of classes) {
    const semantics = input.source.semantics.forFile(class_.sourceFile);
    for (const field of class_.fields) {
      walkSourceTreePostOrder(field.initializer, ast, (node): void => {
        if (!isMojoExpressionNode(node, ast)) return;
        const selectedType = semantics.types.expressionType(node);
        const resolved = resolveMojoTargetType(
          selectedType,
          undefined,
          { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
        );
        if (resolved.kind === "resolved") expressionTypes.set(node, resolved.type);
        const inferred = inferMojoExpressionType(node, ast, expressionTypes);
        if (inferred !== undefined) expressionTypes.set(node, inferred);
      });
      const actual = expressionTypes.get(field.initializer);
      if (actual === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_CLASS_FIELD_INITIALIZER_CARRIER_NOT_CLOSED",
          "Class field initializer has no sealed Mojo carrier.",
          field.initializer,
        ));
        continue;
      }
      const conversion = conversions.record(field.initializer, actual, field.type);
      if (conversion.kind === "unsupported") {
        diagnostics.push(diagnostic("MOJO_VALUE_CONVERSION_UNPROVEN", conversion.reason, field.initializer));
      }
    }
  }

  for (const function_ of functions) {
    const semantics = input.source.semantics.forFile(function_.sourceFile);
    const dependencies = new Set<Node>();
    const iterationNodes: Node[] = [];
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
        if (ast.kindName(node) === "KindThisKeyword" && function_.owner !== undefined) {
          bindingNames.set(node, "self");
          expressionTypes.set(node, function_.owner.type);
        }
      }
      if (ast.is.IsPropertyAccessExpression(node)) {
        const selectedProperty = semantics.operations.propertyAccess(node);
        if (selectedProperty === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_PROPERTY_EVIDENCE_MISSING",
            "Property lowering requires one exact checker-selected access.",
            node,
          ));
        } else {
          const projectProperty = analyzeMojoProjectProperty(selectedProperty, fieldByDeclaration);
          const resolvePropertyType = (type: Type): MojoTargetTypeRef | undefined => {
            const resolved = resolveMojoTargetType(
              type,
              undefined,
              { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
            );
            return resolved.kind === "resolved" ? resolved.type : undefined;
          };
          const property = projectProperty.kind === "not-project-field"
            ? analyzeMojoProviderProperty(selectedProperty, {
                source: input.source,
                providerSemantics,
                conversions,
                resolveType: resolvePropertyType,
              })
            : projectProperty;
          if (property.kind === "unsupported") {
            diagnostics.push(diagnostic(property.code, property.reason, node));
          } else if (property.kind === "resolved") {
            propertySelections.set(node, property.selection);
            expressionTypes.set(node, property.expressionType);
          }
        }
      }
      if (ast.is.IsElementAccessExpression(node)) {
        const selectedElement = semantics.operations.elementAccess(node);
        if (selectedElement === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_ELEMENT_EVIDENCE_MISSING",
            "Element lowering requires one exact checker-selected access.",
            node,
          ));
        } else {
          const element = analyzeMojoElementAccess(
            selectedElement,
            (type) => {
              const resolved = resolveMojoTargetType(
                type,
                undefined,
                { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
              );
              return resolved.kind === "resolved" ? resolved.type : undefined;
            },
            conversions,
          );
          if (element.kind === "unsupported") {
            diagnostics.push(diagnostic(element.code, element.reason, node));
          } else {
            elementSelections.set(node, element.selection);
            expressionTypes.set(node, element.expressionType);
          }
        }
      }
      if (ast.is.IsForOfStatement(node) || ast.is.IsForInStatement(node)) {
        iterationNodes.push(node);
      }
      if (!ast.is.IsCallExpression(node) && !ast.is.IsNewExpression(node)) return;
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
        classByDeclaration,
        classByTypeId,
      });
      if (analyzedCall.kind === "unsupported") {
        diagnostics.push(diagnostic(analyzedCall.code, analyzedCall.reason, node));
        return;
      }
      if (analyzedCall.dependency !== undefined) dependencies.add(analyzedCall.dependency);
      callSelections.set(node, analyzedCall.selection);
    });
    for (const node of iterationNodes) {
        const selectedIteration = semantics.operations.iteration(node);
        const iterable = Node_Expression(ast, node);
        if (selectedIteration === undefined || iterable === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_ITERATION_EVIDENCE_MISSING",
            "Iteration lowering requires one exact checker-selected iteration operation.",
            node,
          ));
        } else {
          const iteration = analyzeMojoIteration({
            ast,
            statement: node,
            iterable,
            source: selectedIteration,
            bindingNames,
            bindingTypes,
            resolveType(type) {
              const resolved = resolveMojoTargetType(
                type,
                undefined,
                { ast, semantics, sourceFacts: input.source.sourceFacts, providerSemantics, projectTypes, jsEnabled },
              );
              return resolved.kind === "resolved" ? resolved.type : undefined;
            },
          });
          if (iteration.kind === "unsupported") {
            diagnostics.push(diagnostic(iteration.code, iteration.reason, node));
          } else {
            iterationSelections.set(node, iteration.selection);
          }
        }
    }
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
      propertySelections,
      elementSelections,
      conversions,
      diagnostics,
    );
    let functionRaises = false;
    walkSourceTree(function_.body, ast, (node): void => {
      if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
        const selection = callSelections.get(node);
        if (selection?.kind === "provider") {
          functionRaises = functionRaises || selection.operation.raises === true ||
            providerCallRequiresRaisingConversion(selection);
        }
      }
      if (ast.is.IsPropertyAccessExpression(node)) {
        const selection = propertySelections.get(node);
        if (selection?.kind === "provider") {
          functionRaises = functionRaises || selection.readOperation?.raises === true ||
            selection.writeOperation?.raises === true ||
            selection.receiverConversion?.kind === "js-to-native-string" ||
            selection.readResultConversion?.kind === "js-to-native-string";
        }
      }
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
  const finalizedByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  for (const function_ of finalizedFunctions) finalizedByDeclaration.set(function_.declaration, function_);
  const finalizedClasses = classes.map((class_) => Object.freeze({
    ...class_,
    methods: Object.freeze(class_.methods.map((method) => finalizedByDeclaration.get(method.declaration) ?? method)),
    constructors: Object.freeze(class_.constructors.map((constructor) =>
      finalizedByDeclaration.get(constructor.declaration) ?? constructor)),
  }));

  for (const function_ of finalizedFunctions) {
    validateMojoFunctionSyntax(
      function_,
      ast,
      callSelections,
      propertySelections,
      elementSelections,
      iterationSelections,
      bindingNames,
      diagnostics,
    );
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
    propertySelection(access: Node): MojoPropertySelection | undefined {
      return propertySelections.get(access);
    },
    elementSelection(access: Node): MojoElementSelection | undefined {
      return elementSelections.get(access);
    },
    iterationSelection(statement: Node): MojoIterationSelection | undefined {
      return iterationSelections.get(statement);
    },
  });
  const topLevelFunctions = finalizedFunctions.filter((function_) => function_.kind === "function");
  const declarations: MojoAnalyzedDeclaration[] = [...topLevelFunctions, ...finalizedClasses];
  return resolvedTargetStage(Object.freeze({
    configuration,
    source: targetSourceSyntaxProgram(input.source),
    projectTypes,
    declarations: Object.freeze(declarations),
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
