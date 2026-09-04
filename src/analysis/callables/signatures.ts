import { argumentPassingFactKey } from "@tsonic/tsts";
import type { Node, Signature, SourceFile, Type } from "@tsonic/tsts";
import { Node_Initializer, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type {
  SourceCallableParameterEvidence,
  SourceCallableTypeEvidence,
} from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedCallableSignature,
  MojoAnalyzedFunction,
  MojoAnalyzedParameter,
  MojoAnalyzedTypeParameter,
} from "../program/model.js";
import {
  analyzeMojoParameterDisposition,
} from "../representations/index.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import {
  classifyMojoSourceGenericParameter,
} from "../../source/semantics/generic-parameters.js";
import {
  resolveMojoValueGenericArgument,
} from "../../policy/types/generic-arguments.js";
import { resolveMojoSourceOrigin } from "../../policy/types/origins.js";
import { mojoLifecycleTraitTargetType } from "../../target-model/lifecycle/index.js";
import { mojoSourceGenericLifecycleRequirements } from "../../policy/types/generic-lifecycle.js";
import { allocateMojoBindingPatternNames } from "../program/local-bindings.js";

export interface MojoTypeParameterAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly lifecycle: MojoLifecycleResolver;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly diagnostics: TargetDiagnostic[];
}

export interface MojoCallableSignatureInput extends MojoTypeParameterAnalysisInput {
  readonly name: string;
  readonly implementationAdapterName?: string;
  readonly allocateLocalName: (sourceName: string) => string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly kind?: MojoAnalyzedCallableSignature["kind"];
  readonly owner?: MojoAnalyzedCallableSignature["owner"];
  readonly static?: boolean;
  readonly callable?: SourceCallableTypeEvidence;
  readonly resultType?: MojoTargetTypeRef;
}

export interface MojoFunctionSignatureInput extends MojoCallableSignatureInput {
  readonly body: Node;
}

export function analyzeMojoFunctionSignature(
  input: MojoFunctionSignatureInput,
): MojoAnalyzedFunction | undefined {
  const { source, declaration } = input;
  const semantics = source.semantics.forFile(input.sourceFile);
  const generator = semantics.operations.generator(declaration);
  if (generator !== undefined) {
    append(
      input,
      "MOJO_GENERATOR_NATIVE_LIMIT",
      `The pinned Mojo target exposes no authored ${generator.generatorKind} generator contract with exact yield, return, and next-value semantics.`,
      declaration,
    );
    return undefined;
  }
  const signature = analyzeMojoCallableSignature(input);
  return signature === undefined
    ? undefined
    : Object.freeze({ ...signature, body: input.body });
}

export function analyzeMojoCallableSignature(
  input: MojoCallableSignatureInput,
): MojoAnalyzedCallableSignature | undefined {
  const { source, declaration, sourceFile } = input;
  const { ast } = source;
  const semantics = source.semantics.forFile(sourceFile);
  const callableType = semantics.declarations.declaredValueType(declaration);
  const callable = input.callable ?? selectDeclarationCallable(
    declaration,
    callableType,
    semantics,
    ast,
  ) ?? (ast.body(declaration) === undefined
    ? undefined
    : selectImplementationCallable(input));
  const callableParameters = callable?.parameters ??
    (input.kind === "getter" || input.kind === "setter"
      ? selectAccessorParameters(input)
      : undefined);
  if (callableParameters === undefined) {
    append(input, "MOJO_FUNCTION_SIGNATURE_NOT_PROVEN", "The checker supplied no exact callable signature.", declaration);
    return undefined;
  }
  const sourceParameters = ast.parameters(declaration);
  if (sourceParameters.length !== callableParameters.length ||
    sourceParameters.some((parameter) => parameter === undefined)) {
    append(input, "MOJO_FUNCTION_PARAMETER_EVIDENCE_MISMATCH", "Function syntax and checker parameter evidence do not align exactly.", declaration);
    return undefined;
  }
  const typeParameters = analyzeMojoTypeParameters(input);
  if (typeParameters === undefined) return undefined;
  const parameters: MojoAnalyzedParameter[] = [];
  for (const [index, parameter] of (sourceParameters as readonly Node[]).entries()) {
    const nameNode = ast.name(parameter);
    const selected = callableParameters[index];
    const bindingPattern = nameNode !== undefined &&
      (ast.is.IsArrayBindingPattern(nameNode) || ast.is.IsObjectBindingPattern(nameNode));
    if (nameNode === undefined || (!ast.is.IsIdentifier(nameNode) && !bindingPattern) ||
      selected === undefined || !ast.is.IsParameterDeclaration(parameter)) {
      append(input, "MOJO_PARAMETER_SHAPE_UNSUPPORTED", "A parameter requires one exact identifier or binding-pattern declaration.", parameter);
      return undefined;
    }
    const resolved = resolve(input, selected.type, ast.typeNode(parameter), "parameter");
    if (resolved === undefined) return undefined;
    const rest = ast.as.AsParameterDeclaration(parameter)!.DotDotDotToken !== undefined;
    const parameterType = rest ? restElementType(resolved) : resolved;
    if (parameterType === undefined) {
      append(input, "MOJO_REST_PARAMETER_CARRIER_UNSUPPORTED", "A rest parameter requires one exact list element carrier.", parameter);
      return undefined;
    }
    const passingFact = source.sourceFacts.getFact(parameter, argumentPassingFactKey);
    const useSummary = source.navigation.parameterUseSummary(parameter);
    const disposition = analyzeMojoParameterDisposition(
      passingFact?.mode,
      useSummary?.bindingWritten === true,
    );
    if (disposition.kind === "immutable" && disposition.localCopy &&
      input.lifecycle.capabilities(parameterType).copy === "unavailable") {
      append(
        input,
        "MOJO_REASSIGNED_PARAMETER_COPY_UNPROVEN",
        "A reassigned ordinary parameter requires an exactly copyable Mojo carrier or an explicit ownership contract.",
        parameter,
      );
      return undefined;
    }
    const sourceName = ast.is.IsIdentifier(nameNode)
      ? ast.text(nameNode)
      : `argument${index + 1}`;
    const name = input.allocateLocalName(sourceName);
    if (bindingPattern) {
      allocateMojoBindingPatternNames(
        nameNode,
        undefined,
        input.allocateLocalName,
        input.bindingNames,
        undefined,
        ast,
        input.diagnostics,
      );
    }
    const omissionKind = selected.omissionKind;
    const omittedType = (omissionKind === "undefined" || omissionKind === "initializer") &&
        resolved.kind !== "optional"
      ? Object.freeze({ kind: "optional" as const, value: resolved })
      : resolved;
    const bodyType = omissionKind === "undefined" ? omittedType : resolved;
    const callType = omissionKind === "undefined" || omissionKind === "initializer"
      ? omittedType
      : resolved;
    const incomingName = omissionKind === "initializer" || omissionKind === "rest" ||
        disposition.kind === "immutable" && disposition.localCopy
        ? input.allocateLocalName(`${sourceName}_slot`)
        : name;
    input.bindingNames.set(parameter, name);
    input.bindingTypes.set(parameter, bodyType);
    parameters.push(Object.freeze({
      declaration: parameter,
      name,
      incomingName,
      type: rest ? parameterType : bodyType,
      bodyType,
      callType,
      disposition,
      omissionKind,
      ...(bindingPattern ? { bindingPatternNode: nameNode } : {}),
      ...(Node_Initializer(ast, parameter) === undefined
        ? {}
        : { initializer: Node_Initializer(ast, parameter)! }),
    }));
  }
  const selectedResultType = input.resultType ??
    (input.kind === "setter"
      ? Object.freeze({ kind: "unit" as const })
      : callable === undefined
        ? resolve(
            input,
            semantics.declarations.declaredValueType(declaration) ??
            semantics.declarations.declaredType(declaration),
            ast.typeNode(declaration),
            "result",
          )
        : resolve(
            input,
            callable.result.selectedType,
            callable.result.authoredTypeNode ?? ast.typeNode(declaration),
            "result",
          ));
  if (selectedResultType === undefined) return undefined;
  const asynchronous = ast.hasModifierKind(declaration, "async");
  if (asynchronous && selectedResultType.kind !== "future") {
    append(
      input,
      "MOJO_ASYNC_RESULT_CARRIER_NOT_CLOSED",
      "An async declaration requires one exact source-profile Promise output carrier.",
      declaration,
    );
    return undefined;
  }
  const asyncResult = asynchronous && selectedResultType.kind === "future"
    ? selectedResultType
    : undefined;
  const resultType = asyncResult?.output ?? selectedResultType;
  return Object.freeze({
    kind: input.kind ?? "function",
    declaration,
    sourceFile,
    name: input.name,
    ...(input.implementationAdapterName === undefined
      ? {}
      : { implementationAdapterName: input.implementationAdapterName }),
    typeParameters,
    parameters: Object.freeze(parameters),
    resultType,
    asynchronous,
    ...(asyncResult === undefined ? {} : { asyncDomain: asyncResult.domain }),
    raises: false,
    ...(input.static === undefined ? {} : { static: input.static }),
    ...(input.owner === undefined ? {} : { owner: input.owner }),
  });
}

function selectDeclarationCallable(
  declaration: Node,
  callableType: Type | undefined,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): SourceCallableTypeEvidence | undefined {
  if (callableType === undefined) return undefined;
  const exactSignatures = semantics.types.callSignatures(callableType).filter((signature) =>
    semantics.declarations.signatureDeclaration(signature) === declaration);
  if (exactSignatures.length === 1) {
    return callableEvidenceForSignature(exactSignatures[0]!, semantics, ast);
  }
  return exactSignatures.length === 0 ? semantics.types.callable(callableType) : undefined;
}

function callableEvidenceForSignature(
  signature: Signature,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): SourceCallableTypeEvidence | undefined {
  const resultType = semantics.types.returnType(signature);
  if (resultType === undefined) return undefined;
  const resultDeclaration = semantics.declarations.signatureDeclaration(signature);
  return Object.freeze({
    parameters: Object.freeze(semantics.types.signatureParameterInfos(signature).map((parameter) => {
      const omissionKind = parameter.parameterKind === "rest"
        ? "rest" as const
        : parameter.parameterKind === "required"
          ? "required" as const
          : parameter.declaration !== undefined &&
              ast.is.IsParameterDeclaration(parameter.declaration) &&
              Node_Initializer(ast, parameter.declaration) !== undefined
            ? "initializer" as const
            : "undefined" as const;
      return Object.freeze({ ...parameter, omissionKind });
    })),
    result: Object.freeze({
      selectedType: resultType,
      ...(resultDeclaration === undefined ? {} : { declaration: resultDeclaration }),
      ...(resultDeclaration === undefined || ast.typeNode(resultDeclaration) === undefined
        ? {}
        : { authoredTypeNode: ast.typeNode(resultDeclaration)! }),
    }),
  });
}

function selectAccessorParameters(
  input: MojoCallableSignatureInput,
): readonly SourceCallableParameterEvidence[] | undefined {
  const { ast } = input.source;
  const semantics = input.source.semantics.forFile(input.sourceFile);
  const parameters: SourceCallableParameterEvidence[] = [];
  for (const parameter of ast.parameters(input.declaration)) {
    const name = parameter === undefined ? undefined : ast.name(parameter);
    const reference = name === undefined
      ? undefined
      : input.source.navigation.sourceReferenceFor(name);
    const type = parameter === undefined
      ? undefined
      : semantics.declarations.declaredValueType(parameter) ??
        semantics.declarations.declaredType(parameter) ??
        (ast.typeNode(parameter) === undefined
          ? undefined
          : semantics.types.authoredType(ast.typeNode(parameter)!));
    if (parameter === undefined || !ast.is.IsParameterDeclaration(parameter) ||
      reference?.symbol === undefined || type === undefined) return undefined;
    const rest = ast.as.AsParameterDeclaration(parameter)!.DotDotDotToken !== undefined;
    const optional = ast.questionToken(parameter) !== undefined || Node_Initializer(ast, parameter) !== undefined;
    parameters.push(Object.freeze({
      sourceSymbol: reference.symbol,
      type,
      parameterKind: rest ? "rest" : optional ? "optional" : "required",
      declaration: parameter,
      omissionKind: rest
        ? "rest"
        : Node_Initializer(ast, parameter) !== undefined
          ? "initializer"
          : optional
            ? "undefined"
            : "required",
    }));
  }
  return Object.freeze(parameters);
}

function selectImplementationCallable(
  input: MojoCallableSignatureInput,
): SourceCallableTypeEvidence | undefined {
  const { ast } = input.source;
  const semantics = input.source.semantics.forFile(input.sourceFile);
  const parameters: SourceCallableParameterEvidence[] = [];
  for (const parameter of ast.parameters(input.declaration)) {
    const name = parameter === undefined ? undefined : ast.name(parameter);
    const reference = name === undefined
      ? undefined
      : input.source.navigation.sourceReferenceFor(name);
    const typeNode = parameter === undefined ? undefined : ast.typeNode(parameter);
    const type = parameter === undefined
      ? undefined
      : semantics.declarations.declaredValueType(parameter) ??
        semantics.declarations.declaredType(parameter) ??
        (typeNode === undefined ? undefined : semantics.types.authoredType(typeNode));
    if (parameter === undefined || !ast.is.IsParameterDeclaration(parameter) ||
      reference?.symbol === undefined || type === undefined) return undefined;
    const rest = ast.as.AsParameterDeclaration(parameter)!.DotDotDotToken !== undefined;
    const initializer = Node_Initializer(ast, parameter);
    const optional = ast.questionToken(parameter) !== undefined || initializer !== undefined;
    parameters.push(Object.freeze({
      sourceSymbol: reference.symbol,
      type,
      parameterKind: rest ? "rest" : optional ? "optional" : "required",
      declaration: parameter,
      omissionKind: rest
        ? "rest"
        : initializer !== undefined
          ? "initializer"
          : optional
            ? "undefined"
            : "required",
    }));
  }
  const resultNode = ast.typeNode(input.declaration);
  const resultType = resultNode === undefined
    ? undefined
    : semantics.types.authoredType(resultNode);
  return resultType === undefined
    ? undefined
    : Object.freeze({
        parameters: Object.freeze(parameters),
        result: Object.freeze({
          selectedType: resultType,
          authoredTypeNode: resultNode,
          declaration: input.declaration,
        }),
      });
}

export function analyzeMojoTypeParameters(
  input: MojoTypeParameterAnalysisInput,
): readonly MojoAnalyzedTypeParameter[] | undefined {
  const { ast } = input.source;
  const parameters: MojoAnalyzedTypeParameter[] = [];
  for (const parameter of ast.typeParameters(input.declaration)) {
    const nameNode = parameter === undefined ? undefined : ast.name(parameter);
    if (parameter === undefined || !ast.is.IsTypeParameterDeclaration(parameter) ||
      nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
      append(input, "MOJO_TYPE_PARAMETER_SHAPE_UNSUPPORTED", "A generic declaration requires exact named type parameters.", parameter ?? input.declaration);
      return undefined;
    }
    const constraintNode = ast.as.AsTypeParameterDeclaration(parameter)?.Constraint;
    const classified = classifyMojoSourceGenericParameter(
      input.declaration,
      parameter,
      typeResolutionContext(input),
    );
    if (classified.kind === "unsupported") {
      append(input, "MOJO_GENERIC_PARAMETER_KIND_UNRESOLVED", classified.reason, parameter);
      return undefined;
    }
    const parameterType = input.source.semantics.forFile(input.sourceFile)
      .declarations.declaredType(parameter);
    if (parameterType === undefined) {
      append(
        input,
        "MOJO_TYPE_PARAMETER_SEMANTIC_TYPE_MISSING",
        "A generic parameter requires one exact checker-owned semantic type.",
        parameter,
      );
      return undefined;
    }
    const constraints: MojoTargetTypeRef[] = classified.parameter.kind === "type"
      ? mojoSourceGenericLifecycleRequirements(input.declaration, parameterType, {
          source: input.source,
          semantics: input.source.semantics.forFile(input.sourceFile),
        }).map(mojoLifecycleTraitTargetType)
      : classified.parameter.kind === "origin"
        ? [Object.freeze({
            kind: "target-named",
            id: "mojo.builtin.Origin",
            modulePath: Object.freeze([]),
            name: "Origin",
          })]
        : [];
    if (constraintNode !== undefined && classified.parameter.kind !== "origin") {
      const selected = input.source.semantics.forFile(input.sourceFile).types.authoredType(constraintNode);
      const constraint = resolve(input, selected, constraintNode, "constraint");
      if (constraint === undefined) return undefined;
      constraints.push(constraint);
    }
    if (classified.parameter.kind === "value" && constraints.length !== 1) {
      append(
        input,
        "MOJO_COMPTIME_VALUE_PARAMETER_CONSTRAINT_REQUIRED",
        "A compile-time value parameter requires one exact target value type constraint.",
        parameter,
      );
      return undefined;
    }
    const defaultType = ast.as.AsTypeParameterDeclaration(parameter)?.DefaultType;
    const defaultArgument = defaultType === undefined
      ? undefined
      : resolveGenericDefault(input, classified.parameter.kind, defaultType);
    if (defaultType !== undefined && defaultArgument === undefined) return undefined;
    const identity = sourceNodeIdentity(ast, parameter);
    if (identity === undefined) {
      append(input, "MOJO_TYPE_PARAMETER_IDENTITY_UNRESOLVED", "A generic parameter requires one stable source identity.", parameter);
      return undefined;
    }
    parameters.push(Object.freeze({
      declaration: parameter,
      identity,
      kind: classified.parameter.kind,
      name: classified.parameter.name,
      position: "positional-or-keyword",
      variadic: false,
      constraints: Object.freeze(constraints),
      ...(defaultArgument === undefined ? {} : { defaultArgument }),
    }));
  }
  return Object.freeze(parameters);
}

function resolveGenericDefault(
  input: MojoTypeParameterAnalysisInput,
  kind: MojoAnalyzedTypeParameter["kind"],
  node: Node,
): import("../../target-model/types/model.js").MojoTargetGenericArgument | undefined {
  if (kind === "value") {
    const value = resolveMojoValueGenericArgument(node, typeResolutionContext(input));
    if (value === undefined) {
      append(input, "MOJO_COMPTIME_VALUE_DEFAULT_UNSUPPORTED", "A compile-time value default must be one exact literal value.", node);
    }
    return value;
  }
  if (kind === "origin") {
    const origin = resolveMojoSourceOrigin(node, typeResolutionContext(input));
    if (origin === undefined) {
      append(input, "MOJO_ORIGIN_DEFAULT_UNSUPPORTED", "An origin default requires one exact authored Mojo origin.", node);
      return undefined;
    }
    return Object.freeze({ kind: "origin", origin });
  }
  const selected = input.source.semantics.forFile(input.sourceFile).types.authoredType(node);
  const type = resolve(input, selected, node, "generic-default");
  return type === undefined ? undefined : Object.freeze({ kind: "type", type });
}

function typeResolutionContext(input: MojoTypeParameterAnalysisInput) {
  return {
    ast: input.source.ast,
    navigation: input.source.navigation,
    semantics: input.source.semantics.forFile(input.sourceFile),
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
  };
}

function resolve(
  input: MojoTypeParameterAnalysisInput,
  selectedType: Type | undefined,
  authoredTypeNode: Node | undefined,
  role: "parameter" | "result" | "constraint" | "generic-default",
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(selectedType, authoredTypeNode, typeResolutionContext(input));
  if (resolved.kind === "resolved") return resolved.type;
  const subject = role === "parameter" ? "callable parameter"
    : role === "result" ? "callable result"
      : role === "constraint" ? "generic constraint"
        : "generic default";
  append(
    input,
    role === "parameter" ? "MOJO_CALLABLE_PARAMETER_CARRIER_UNRESOLVED"
      : role === "result" ? "MOJO_CALLABLE_RESULT_CARRIER_UNRESOLVED"
        : role === "constraint" ? "MOJO_GENERIC_CONSTRAINT_CARRIER_UNRESOLVED"
          : "MOJO_GENERIC_DEFAULT_CARRIER_UNRESOLVED",
    `Selected ${subject} type cannot be represented exactly in Mojo: ${resolved.reason}.`,
    authoredTypeNode ?? input.declaration,
  );
  return undefined;
}

function restElementType(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (type.kind === "list") return type.element;
  if (type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray") {
    const argument = type.genericArguments?.[0];
    return argument?.kind === "type" ? argument.type : undefined;
  }
  return undefined;
}

function append(
  input: MojoTypeParameterAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
