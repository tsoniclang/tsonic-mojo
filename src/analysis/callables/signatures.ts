import { argumentPassingFactKey } from "@tsonic/tsts";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import { Node_Initializer, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { SourceCallableTypeEvidence } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
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

export interface MojoFunctionSignatureInput extends MojoTypeParameterAnalysisInput {
  readonly name: string;
  readonly body: Node;
  readonly allocateLocalName: (sourceName: string) => string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly kind?: MojoAnalyzedFunction["kind"];
  readonly owner?: MojoAnalyzedFunction["owner"];
  readonly static?: boolean;
  readonly callable?: SourceCallableTypeEvidence;
  readonly resultType?: MojoTargetTypeRef;
}

export function analyzeMojoFunctionSignature(
  input: MojoFunctionSignatureInput,
): MojoAnalyzedFunction | undefined {
  const { source, declaration, sourceFile } = input;
  const { ast } = source;
  const semantics = source.semantics.forFile(sourceFile);
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
  const callableType = semantics.declarations.declaredValueType(declaration);
  const callable = input.callable ??
    (callableType === undefined ? undefined : semantics.types.callable(callableType));
  if (callable === undefined) {
    append(input, "MOJO_FUNCTION_SIGNATURE_NOT_PROVEN", "The checker supplied no exact callable signature.", declaration);
    return undefined;
  }
  const sourceParameters = ast.parameters(declaration);
  if (sourceParameters.length !== callable.parameters.length ||
    sourceParameters.some((parameter) => parameter === undefined)) {
    append(input, "MOJO_FUNCTION_PARAMETER_EVIDENCE_MISMATCH", "Function syntax and checker parameter evidence do not align exactly.", declaration);
    return undefined;
  }
  const typeParameters = analyzeMojoTypeParameters(input);
  if (typeParameters === undefined) return undefined;
  const parameters: MojoAnalyzedParameter[] = [];
  for (const [index, parameter] of (sourceParameters as readonly Node[]).entries()) {
    const nameNode = ast.name(parameter);
    const selected = callable.parameters[index];
    if (nameNode === undefined || !ast.is.IsIdentifier(nameNode) || selected === undefined ||
      !ast.is.IsParameterDeclaration(parameter)) {
      append(input, "MOJO_PARAMETER_SHAPE_UNSUPPORTED", "Mojo requires one exact named parameter declaration.", parameter);
      return undefined;
    }
    const resolved = resolve(input, selected.type, ast.typeNode(parameter));
    if (resolved === undefined) return undefined;
    const rest = ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined;
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
    const name = input.allocateLocalName(ast.text(nameNode));
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
      ? input.allocateLocalName(`${ast.text(nameNode)}_slot`)
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
      ...(Node_Initializer(ast, parameter) === undefined
        ? {}
        : { initializer: Node_Initializer(ast, parameter)! }),
    }));
  }
  const selectedResultType = input.resultType ?? resolve(
    input,
    callable.result.selectedType,
    callable.result.authoredTypeNode ?? ast.typeNode(declaration),
  );
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
    typeParameters,
    parameters: Object.freeze(parameters),
    resultType,
    body: input.body,
    asynchronous,
    ...(asyncResult === undefined ? {} : { asyncDomain: asyncResult.domain }),
    raises: false,
    ...(input.static === undefined ? {} : { static: input.static }),
    ...(input.owner === undefined ? {} : { owner: input.owner }),
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
      const constraint = resolve(input, selected, constraintNode);
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
  const type = resolve(input, selected, node);
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
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(selectedType, authoredTypeNode, typeResolutionContext(input));
  if (resolved.kind === "resolved") return resolved.type;
  append(input, "MOJO_TARGET_TYPE_UNSUPPORTED", `Selected source type cannot be represented exactly in Mojo: ${resolved.reason}.`, authoredTypeNode ?? input.declaration);
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
