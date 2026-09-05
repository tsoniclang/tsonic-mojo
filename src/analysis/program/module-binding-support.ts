import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { tsonicCompileTimeFactKey } from "@tsonic/source-core/facts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { classifyMojoBindingDisposition } from "../representations/index.js";
import type {
  MojoAnalyzedModuleBinding,
  MojoModuleInitializationStep,
} from "./model.js";
import type { MojoModuleBindingAnalysisInput } from "./module-bindings.js";

export function analyzeModuleBindingPattern(
  declaration: Node,
  pattern: Node,
  declarationKind: "const" | "let" | "var",
  sourceFile: SourceFile,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  input: MojoModuleBindingAnalysisInput,
): Extract<MojoModuleInitializationStep, { readonly kind: "binding-pattern" }> | undefined {
  const { ast } = input.source;
  const initializer = Node_Initializer(ast, declaration);
  if (initializer === undefined) {
    input.diagnostics.push(diagnostic(
      "MOJO_MODULE_BINDING_INITIALIZER_REQUIRED",
      "A top-level binding pattern requires one explicit aggregate initializer.",
      declaration,
    ));
    return undefined;
  }
  if (isExplicitCompileTimeInitializer(initializer, input.source)) {
    input.diagnostics.push(diagnostic(
      "MOJO_MODULE_COMPTIME_BINDING_PATTERN_UNSUPPORTED",
      "An explicit compile-time aggregate must be named before its values are destructured.",
      declaration,
    ));
    return undefined;
  }
  const sourceType = resolveModuleBindingType(
    semantics.types.expressionType(initializer),
    undefined,
    declaration,
    semantics,
    input,
  );
  if (sourceType === undefined) return undefined;
  input.bindType(declaration, sourceType);
  input.bindSourceFile(declaration, sourceFile);
  const bindings: MojoAnalyzedModuleBinding[] = [];
  if (!collectModuleBindingPatternLeaves(
    pattern,
    initializer,
    declarationKind,
    sourceFile,
    semantics,
    input,
    bindings,
  )) return undefined;
  return Object.freeze({
    kind: "binding-pattern",
    declaration,
    initializer,
    sourceType,
    bindings: Object.freeze(bindings),
  });
}

function collectModuleBindingPatternLeaves(
  pattern: Node,
  initializer: Node,
  declarationKind: "const" | "let" | "var",
  sourceFile: SourceFile,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  input: MojoModuleBindingAnalysisInput,
  bindings: MojoAnalyzedModuleBinding[],
): boolean {
  const { ast } = input.source;
  let valid = true;
  for (const element of ast.elements(pattern)) {
    if (element === undefined || ast.is.IsOmittedExpression(element)) continue;
    if (!ast.is.IsBindingElement(element)) {
      input.diagnostics.push(diagnostic(
        "MOJO_MODULE_BINDING_ELEMENT_INVALID",
        "A top-level binding pattern contains a non-binding element.",
        element,
      ));
      valid = false;
      continue;
    }
    const nameNode = ast.name(element);
    if (nameNode === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_MODULE_BINDING_NAME_MISSING",
        "A top-level binding element has no exact authored target.",
        element,
      ));
      valid = false;
      continue;
    }
    if (ast.is.IsArrayBindingPattern(nameNode) || ast.is.IsObjectBindingPattern(nameNode)) {
      valid = collectModuleBindingPatternLeaves(
        nameNode,
        initializer,
        declarationKind,
        sourceFile,
        semantics,
        input,
        bindings,
      ) && valid;
      continue;
    }
    if (!ast.is.IsIdentifier(nameNode)) {
      input.diagnostics.push(diagnostic(
        "MOJO_MODULE_BINDING_NAME_UNSUPPORTED",
        "A top-level binding element requires one exact identifier or nested pattern.",
        nameNode,
      ));
      valid = false;
      continue;
    }
    const type = resolveModuleBindingType(
      semantics.declarations.declaredValueType(element) ??
        semantics.declarations.declaredType(element),
      undefined,
      element,
      semantics,
      input,
    );
    if (type === undefined) {
      valid = false;
      continue;
    }
    const sourceName = ast.text(nameNode);
    const name = input.allocateModuleName(sourceFile, sourceName);
    const binding = Object.freeze({
      kind: "module-binding" as const,
      declaration: element,
      sourceFile,
      sourceName,
      name,
      declarationKind,
      disposition: classifyMojoBindingDisposition({
        declaration: element,
        initializer,
        declarationKind,
        type,
        comptime: false,
        source: input.source,
      }),
      type,
      initializer,
    }) satisfies MojoAnalyzedModuleBinding;
    bindings.push(binding);
    input.bindName(element, name);
    input.bindName(nameNode, name);
    input.bindSourceFile(element, sourceFile);
    input.bindSourceFile(nameNode, sourceFile);
    input.bindType(element, type);
    input.bindType(nameNode, type);
  }
  return valid;
}

export function resolveModuleBindingType(
  selectedType: import("@tsonic/tsts").Type | undefined,
  authoredTypeNode: Node | undefined,
  evidence: Node,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  input: MojoModuleBindingAnalysisInput,
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(selectedType, authoredTypeNode, {
    ast: input.source.ast,
    navigation: input.source.navigation,
    semantics,
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
  });
  if (resolved.kind === "resolved") return resolved.type;
  input.diagnostics.push(diagnostic(
    "MOJO_MODULE_BINDING_CARRIER_UNRESOLVED",
    `Selected top-level binding type cannot be represented exactly in Mojo: ${resolved.reason}.`,
    evidence,
  ));
  return undefined;
}

export function isExplicitCompileTimeInitializer(
  initializer: Node,
  source: TargetSourceProgram,
): boolean {
  const fact = source.sourceFacts.getFact(initializer, tsonicCompileTimeFactKey);
  return fact?.kind === "value" || fact?.kind === "type";
}

export function diagnostic(code: string, message: string, node: Node): TargetDiagnostic {
  return mojoAnalysisDiagnostic(code, message, node);
}

