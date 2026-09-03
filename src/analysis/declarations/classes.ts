import type { Node, SourceFile, Type } from "@tsonic/tsts";
import {
  Node_Initializer,
} from "@tsonic/target-api/source";
import type {
  SourceCallableTypeEvidence,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { mojoGenericParameterReference } from "../../target-model/types/constructors.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import {
  analyzeMojoFunctionSignature,
  analyzeMojoTypeParameters,
} from "../callables/signatures.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedClassField,
  MojoAnalyzedFunction,
} from "../program/model.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";

export interface MojoClassAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly lifecycle: MojoLifecycleResolver;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly diagnostics: TargetDiagnostic[];
  readonly allocateLocalBindings: (
    body: Node,
    allocate: (name: string) => string,
  ) => void;
  readonly createNameAllocator: () => (name: string) => string;
}

export interface MojoClassAnalysisResult {
  readonly class_: MojoAnalyzedClass;
  readonly callables: readonly MojoAnalyzedFunction[];
  readonly fields: readonly MojoAnalyzedClassField[];
}

export function analyzeMojoClass(
  input: MojoClassAnalysisInput,
): MojoClassAnalysisResult | undefined {
  const { source, declaration } = input;
  const { ast } = source;
  const definition = input.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class") {
    append(input, "MOJO_CLASS_IDENTITY_UNRESOLVED", "Class lowering requires one exact project-class identity.", declaration);
    return undefined;
  }
  const heritage = source.navigation.declaredHeritage(declaration);
  if (heritage.kind === "unresolved") {
    append(input, "MOJO_CLASS_HERITAGE_UNRESOLVED", heritage.reason, heritage.heritage);
    return undefined;
  }
  if (heritage.edges.length !== 0) {
    append(input, "MOJO_CLASS_HERITAGE_UNSUPPORTED", "Project-class inheritance requires a sealed Mojo representation plan.", declaration);
    return undefined;
  }

  const targetArguments = definition.typeParameters.map(mojoGenericParameterReference);
  const targetType = input.projectTypes.targetTypeForDefinition(definition, targetArguments);
  if (targetType === undefined) {
    append(input, "MOJO_CLASS_TYPE_NOT_CLOSED", "Class generic parameters do not close its exact Mojo carrier.", declaration);
    return undefined;
  }
  const owner = Object.freeze({ name: input.name, stateName: input.stateName, type: targetType });
  const classNames = input.createNameAllocator();
  const fields: MojoAnalyzedClassField[] = [];
  const methods: MojoAnalyzedFunction[] = [];
  const constructors: MojoAnalyzedFunction[] = [];
  const semantics = source.semantics.forFile(input.sourceFile);
  const members = ast.members(declaration);
  if (members.some((member) => member === undefined)) {
    append(input, "MOJO_CLASS_MEMBER_EVIDENCE_INCOMPLETE", "Class members require a dense source AST.", declaration);
    return undefined;
  }

  for (const member of members as readonly Node[]) {
    if (ast.is.IsPropertyDeclaration(member)) {
      if (ast.hasModifierKind(member, "static")) {
        continue;
      }
      const nameNode = ast.name(member);
      const initializer = Node_Initializer(ast, member);
      if (nameNode === undefined ||
        (!ast.is.IsIdentifier(nameNode) && !ast.is.IsPrivateIdentifier(nameNode))) {
        append(input, "MOJO_CLASS_FIELD_NAME_UNSUPPORTED", "Class fields require one exact identifier or private-identifier name.", member);
        continue;
      }
      const selected = declaredOrInitializerType(member, initializer, semantics, ast);
      const resolved = resolveType(input, selected, ast.typeNode(member), member);
      if (resolved === undefined) continue;
      const sourceName = ast.text(nameNode);
      const privateMember = ast.hasModifierKind(member, "private") ||
        ast.hasModifierKind(member, "protected") || ast.is.IsPrivateIdentifier(nameNode);
      const name = classNames(privateMember
        ? `_${sourceName.replace(/^#/u, "")}`
        : sourceName);
      input.bindingNames.set(member, name);
      input.bindingTypes.set(member, resolved);
      fields.push(Object.freeze({
        kind: "instance-field",
        declaration: member,
        sourceName,
        name,
        type: resolved,
        ownerType: targetType,
        ownerTypeParameters: definition.typeParameters,
        ...(initializer === undefined ? {} : { initializer }),
        visibility: privateMember ? "private" : "public",
      }));
      continue;
    }
    if (ast.kindName(member) === "KindClassStaticBlockDeclaration") continue;
    if (ast.is.IsMethodDeclaration(member)) {
      const body = ast.body(member);
      const nameNode = ast.name(member);
      const selectedName = nameNode === undefined
        ? undefined
        : projectMethodName(nameNode, semantics, ast);
      if (body === undefined || !ast.is.IsBlock(body) || selectedName === undefined) {
        append(input, "MOJO_CLASS_METHOD_SHAPE_UNSUPPORTED", "Class methods require one exact named implementation body.", member);
        continue;
      }
      const localNames = input.createNameAllocator();
      const privateMember = ast.hasModifierKind(member, "private") ||
        ast.hasModifierKind(member, "protected") || ast.is.IsPrivateIdentifier(nameNode);
      const name = classNames(privateMember
        ? `_${selectedName.replace(/^#/u, "")}`
        : selectedName);
      const method = analyzeMojoFunctionSignature({
        ...signatureInput(input, member, body, name, localNames),
        kind: "method",
        owner,
        static: ast.hasModifierKind(member, "static"),
      });
      if (method === undefined) continue;
      input.bindingNames.set(member, name);
      methods.push(method);
      input.allocateLocalBindings(body, localNames);
      continue;
    }
    if (ast.is.IsConstructorDeclaration(member)) {
      const body = ast.body(member);
      if (body === undefined || !ast.is.IsBlock(body)) {
        append(input, "MOJO_CONSTRUCTOR_BODY_REQUIRED", "A project constructor requires one exact implementation body.", member);
        continue;
      }
      const callable = constructorCallable(input, member);
      if (callable === undefined) continue;
      const localNames = input.createNameAllocator();
      const constructor = analyzeMojoFunctionSignature({
        ...signatureInput(input, member, body, "__init__", localNames),
        kind: "constructor",
        owner,
        callable,
        resultType: Object.freeze({ kind: "unit" }),
      });
      if (constructor === undefined) continue;
      constructors.push(constructor);
      input.allocateLocalBindings(body, localNames);
      continue;
    }
    if (ast.is.IsSemicolonClassElement(member)) continue;
    append(input, "MOJO_CLASS_MEMBER_UNSUPPORTED", `Class member '${ast.kindName(member)}' has no sealed Mojo representation.`, member);
  }

  if (constructors.length > 1) {
    append(input, "MOJO_CONSTRUCTOR_OVERLOAD_SET_UNSUPPORTED", "Constructor overloads require one sealed implementation-to-signature dispatch plan.", declaration);
    return undefined;
  }
  const classTypeParameters = analyzeMojoTypeParameters({
    ...signatureInput(input, declaration, declaration, input.name, input.createNameAllocator()),
  });
  if (classTypeParameters === undefined) return undefined;
  const class_ = Object.freeze({
    kind: "class" as const,
    declaration,
    sourceFile: input.sourceFile,
    name: input.name,
    stateName: input.stateName,
    typeParameters: classTypeParameters,
    fields: Object.freeze(fields),
    methods: Object.freeze(methods),
    constructors: Object.freeze(constructors),
    targetType,
    stateStorage: "direct",
  });
  return Object.freeze({
    class_,
    callables: Object.freeze([...constructors, ...methods]),
    fields: class_.fields,
  });
}

function projectMethodName(
  name: Node,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): string | undefined {
  if (ast.is.IsIdentifier(name) || ast.is.IsPrivateIdentifier(name)) return ast.text(name);
  const wellKnown = semantics.operations.wellKnownSymbol(name);
  if (wellKnown?.kind === "dispose") return "dispose";
  if (wellKnown?.kind === "async-dispose") return "disposeAsync";
  return undefined;
}

function signatureInput(
  input: MojoClassAnalysisInput,
  declaration: Node,
  body: Node,
  name: string,
  allocateLocalName: (sourceName: string) => string,
) {
  return {
    source: input.source,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    lifecycle: input.lifecycle,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
    declaration,
    sourceFile: input.sourceFile,
    name,
    body,
    allocateLocalName,
    bindingNames: input.bindingNames,
    bindingTypes: input.bindingTypes,
    diagnostics: input.diagnostics,
  };
}

function constructorCallable(
  input: MojoClassAnalysisInput,
  declaration: Node,
): SourceCallableTypeEvidence | undefined {
  const selected = input.source.navigation.classConstructors(input.declaration);
  if (selected.kind === "unresolved") {
    append(input, "MOJO_CONSTRUCTOR_SIGNATURE_UNRESOLVED", selected.reason, declaration);
    return undefined;
  }
  const matching = selected.signatures.filter((signature) => signature.declaration === declaration);
  const signatures = matching.length === 0 && selected.signatures.length === 1
    ? selected.signatures
    : matching;
  if (signatures.length !== 1) {
    append(input, "MOJO_CONSTRUCTOR_SIGNATURE_AMBIGUOUS", `Constructor implementation has ${signatures.length} exact effective signatures.`, declaration);
    return undefined;
  }
  const resultType = input.source.semantics.forFile(input.sourceFile)
    .declarations.declaredType(input.declaration);
  if (resultType === undefined) {
    append(input, "MOJO_CONSTRUCTOR_RESULT_TYPE_UNRESOLVED", "The checker supplied no exact project class instance type.", declaration);
    return undefined;
  }
  const parameters = signatures[0]!.parameters.map((parameter) => {
    const syntax = input.source.ast.as.AsParameterDeclaration(parameter.parameterDeclaration);
    const omissionKind = parameter.rest
      ? "rest" as const
      : syntax?.Initializer !== undefined
        ? "initializer" as const
        : parameter.acceptsOmission
          ? "undefined" as const
          : "required" as const;
    return Object.freeze({
      sourceSymbol: parameter.parameterSymbol,
      type: parameter.selectedType,
      parameterKind: parameter.rest ? "rest" as const : parameter.acceptsOmission ? "optional" as const : "required" as const,
      declaration: parameter.parameterDeclaration,
      omissionKind,
    });
  });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    result: Object.freeze({ selectedType: resultType, declaration: input.declaration }),
  });
}

function declaredOrInitializerType(
  declaration: Node,
  initializer: Node | undefined,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): Type | undefined {
  const authored = ast.typeNode(declaration);
  return semantics.declarations.declaredValueType(declaration) ??
    semantics.declarations.declaredType(declaration) ??
    (authored === undefined ? undefined : semantics.types.authoredType(authored)) ??
    (initializer === undefined ? undefined : semantics.types.expressionType(initializer));
}

function resolveType(
  input: MojoClassAnalysisInput,
  selectedType: Type | undefined,
  authoredTypeNode: Node | undefined,
  node: Node,
): MojoTargetTypeRef | undefined {
  const result = resolveMojoTargetType(selectedType, authoredTypeNode, {
    ast: input.source.ast,
    semantics: input.source.semantics.forFile(input.sourceFile),
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
  });
  if (result.kind === "resolved") return result.type;
  append(input, "MOJO_TARGET_TYPE_UNSUPPORTED", `Selected source type cannot be represented exactly in Mojo: ${result.reason}.`, node);
  return undefined;
}

function append(
  input: MojoClassAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
