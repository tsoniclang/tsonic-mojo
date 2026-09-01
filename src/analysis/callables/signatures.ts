import { argumentPassingFactKey } from "@tsonic/tsts";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { SourceCallableTypeEvidence } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoProjectTypeCatalog } from "../types/project-catalog.js";
import type { MojoSourceProfileRegistry } from "../types/source-profile.js";
import { resolveMojoTargetType } from "../types/resolution.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedFunction,
  MojoAnalyzedParameter,
  MojoAnalyzedTypeParameter,
} from "../program/model.js";

export interface MojoFunctionSignatureInput {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly body: Node;
  readonly allocateLocalName: (sourceName: string) => string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly diagnostics: TargetDiagnostic[];
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
    const abi = mojoParameterAbi(passingFact?.mode);
    const name = input.allocateLocalName(ast.text(nameNode));
    input.bindingNames.set(parameter, name);
    input.bindingTypes.set(parameter, resolved);
    parameters.push(Object.freeze({
      declaration: parameter,
      name,
      type: parameterType,
      convention: abi.convention,
      passing: abi.passing,
      optional: selected.omissionKind !== "required",
      rest,
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
  input: MojoFunctionSignatureInput,
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
    const constraints: MojoTargetTypeRef[] = [];
    if (constraintNode !== undefined) {
      const selected = input.source.semantics.forFile(input.sourceFile).types.authoredType(constraintNode);
      const constraint = resolve(input, selected, constraintNode);
      if (constraint === undefined) return undefined;
      constraints.push(constraint);
    }
    parameters.push(Object.freeze({
      declaration: parameter,
      name: ast.text(nameNode),
      constraints: Object.freeze(constraints),
    }));
  }
  return Object.freeze(parameters);
}

function resolve(
  input: MojoFunctionSignatureInput,
  selectedType: Type | undefined,
  authoredTypeNode: Node | undefined,
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(selectedType, authoredTypeNode, {
    ast: input.source.ast,
    semantics: input.source.semantics.forFile(input.sourceFile),
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
  });
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

function mojoParameterAbi(
  mode: import("@tsonic/tsts").ArgumentPassingMode | undefined,
): {
  readonly convention: MojoAnalyzedParameter["convention"];
  readonly passing: MojoAnalyzedParameter["passing"];
} {
  switch (mode) {
    case "byref-readonly": return { convention: "imm", passing: "plain" };
    case "byref-readwrite":
    case "borrow-mut": return { convention: "mut", passing: "plain" };
    case "byref-writeonly-must-init": return { convention: "out", passing: "plain" };
    case "borrow-shared": return { convention: "ref", passing: "plain" };
    case "move": return { convention: "var", passing: "consume" };
    case "by-value":
    case undefined: return { convention: "var", passing: "plain" };
  }
}

function append(
  input: MojoFunctionSignatureInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
