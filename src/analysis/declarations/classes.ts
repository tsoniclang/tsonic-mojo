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
import type {
  MojoProjectTypeCatalog,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { mojoGenericParameterReference } from "../../target-model/types/constructors.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import {
  analyzeMojoCallableSignature,
  analyzeMojoFunctionSignature,
  analyzeMojoTypeParameters,
} from "../callables/signatures.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedClassField,
  MojoAnalyzedAccessorProperty,
  MojoAnalyzedCallableSignature,
  MojoAnalyzedFunction,
} from "../program/model.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import { mojoProjectMethodName } from "./well-known-methods.js";

export interface MojoClassAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleResolver;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly constructorFactoryName: string;
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
  const heritage = input.projectRelationships.heritageForDefinition(definition);

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
  const accessors: MojoAnalyzedFunction[] = [];
  const callableContracts: MojoAnalyzedCallableSignature[] = [];
  const constructors: MojoAnalyzedFunction[] = [];
  const allocatedMemberNames = new Map<string, string>();
  const accessorDrafts = new Map<string, {
    readonly declarations: Node[];
    readonly sourceName: string;
    read?: MojoAnalyzedCallableSignature;
    write?: MojoAnalyzedCallableSignature;
  }>();
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
        : mojoProjectMethodName(nameNode, semantics, ast);
      if (selectedName === undefined || (body !== undefined && !ast.is.IsBlock(body))) {
        append(input, "MOJO_CLASS_METHOD_SHAPE_UNSUPPORTED", "Class methods require one exact name and an optional block implementation body.", member);
        continue;
      }
      const localNames = input.createNameAllocator();
      const privateMember = ast.hasModifierKind(member, "private") ||
        ast.hasModifierKind(member, "protected") || ast.is.IsPrivateIdentifier(nameNode);
      const name = allocateCallableName(
        allocatedMemberNames,
        classNames,
        `${ast.hasModifierKind(member, "static") ? "static" : "instance"}:method:${selectedName}`,
        privateMember ? `_${selectedName.replace(/^#/u, "")}` : selectedName,
      );
      const signatureInput_ = {
        ...callableSignatureInput(input, member, name, localNames),
        kind: "method",
        owner,
        static: ast.hasModifierKind(member, "static"),
        ...(body === undefined
          ? { implementationAdapterName: classNames(`_${selectedName}Overload`) }
          : {}),
      } as const;
      const method = body === undefined
        ? analyzeMojoCallableSignature(signatureInput_)
        : analyzeMojoFunctionSignature({ ...signatureInput_, body });
      if (method === undefined) continue;
      input.bindingNames.set(member, name);
      callableContracts.push(method);
      if (body !== undefined) {
        methods.push(method as MojoAnalyzedFunction);
        input.allocateLocalBindings(body, localNames);
      }
      continue;
    }
    if (ast.is.IsGetAccessorDeclaration(member) || ast.is.IsSetAccessorDeclaration(member)) {
      const body = ast.body(member);
      const nameNode = ast.name(member);
      const sourceName = nameNode === undefined
        ? undefined
        : mojoProjectMethodName(nameNode, semantics, ast);
      if (sourceName === undefined || (body !== undefined && !ast.is.IsBlock(body))) {
        append(input, "MOJO_CLASS_ACCESSOR_SHAPE_UNSUPPORTED", "Class accessors require one exact name and an optional block implementation body.", member);
        continue;
      }
      const getter = ast.is.IsGetAccessorDeclaration(member);
      const privateMember = ast.hasModifierKind(member, "private") ||
        ast.hasModifierKind(member, "protected") || ast.is.IsPrivateIdentifier(nameNode);
      const propertyKey = `${ast.hasModifierKind(member, "static") ? "static" : "instance"}:accessor:${sourceName}`;
      const role = getter ? "get" : "set";
      const callableName = allocateCallableName(
        allocatedMemberNames,
        classNames,
        `${propertyKey}:${role}`,
        `_${role}_${privateMember ? sourceName.replace(/^#/u, "") : sourceName}`,
      );
      const localNames = input.createNameAllocator();
      const signatureInput_ = {
        ...callableSignatureInput(input, member, callableName, localNames),
        kind: getter ? "getter" as const : "setter" as const,
        owner,
        static: ast.hasModifierKind(member, "static"),
      };
      const accessor = body === undefined
        ? analyzeMojoCallableSignature(signatureInput_)
        : analyzeMojoFunctionSignature({ ...signatureInput_, body });
      if (accessor === undefined) continue;
      const draft = accessorDrafts.get(propertyKey) ?? {
        declarations: [],
        sourceName,
      };
      draft.declarations.push(member);
      if (getter) draft.read = accessor;
      else draft.write = accessor;
      accessorDrafts.set(propertyKey, draft);
      input.bindingNames.set(member, callableName);
      callableContracts.push(accessor);
      if (body !== undefined) {
        accessors.push(accessor as MojoAnalyzedFunction);
        input.allocateLocalBindings(body, localNames);
      }
      continue;
    }
    if (ast.is.IsConstructorDeclaration(member)) {
      const body = ast.body(member);
      if (body !== undefined && !ast.is.IsBlock(body)) {
        append(input, "MOJO_CONSTRUCTOR_BODY_INVALID", "A project constructor implementation requires one exact block body.", member);
        continue;
      }
      const callable = body === undefined
        ? selectedConstructorCallable(input, member)
        : constructorImplementationCallable(input, member);
      if (callable === undefined) continue;
      const localNames = input.createNameAllocator();
      const signatureInput_ = {
        ...callableSignatureInput(input, member, "__init__", localNames),
        kind: "constructor",
        owner,
        callable,
        resultType: Object.freeze({ kind: "unit" }),
      } as const;
      const constructor = body === undefined
        ? analyzeMojoCallableSignature(signatureInput_)
        : analyzeMojoFunctionSignature({ ...signatureInput_, body });
      if (constructor === undefined) continue;
      callableContracts.push(constructor);
      if (body !== undefined) {
        constructors.push(constructor as MojoAnalyzedFunction);
        input.allocateLocalBindings(body, localNames);
      }
      continue;
    }
    if (ast.is.IsSemicolonClassElement(member)) continue;
    append(input, "MOJO_CLASS_MEMBER_UNSUPPORTED", `Class member '${ast.kindName(member)}' has no sealed Mojo representation.`, member);
  }

  if (constructors.length > 1) {
    append(input, "MOJO_CONSTRUCTOR_IMPLEMENTATION_AMBIGUOUS", "A checked project class exposed more than one constructor implementation body.", declaration);
    return undefined;
  }
  const classTypeParameters = analyzeMojoTypeParameters({
    ...signatureInput(input, declaration, declaration, input.name, input.createNameAllocator()),
  });
  if (classTypeParameters === undefined) return undefined;
  const class_ = Object.freeze({
    kind: "class" as const,
    definition,
    declaration,
    sourceFile: input.sourceFile,
    name: input.name,
    stateName: input.stateName,
    constructorFactoryName: input.constructorFactoryName,
    typeParameters: classTypeParameters,
    fields: Object.freeze(fields),
    methods: Object.freeze(methods),
    accessors: Object.freeze(accessors),
    callableContracts: Object.freeze(callableContracts),
    accessorProperties: Object.freeze([...accessorDrafts.values()].map((draft): MojoAnalyzedAccessorProperty => Object.freeze({
      kind: "accessor-property",
      declarations: Object.freeze([...draft.declarations]),
      sourceName: draft.sourceName,
      ...(draft.read === undefined ? {} : { read: draft.read }),
      ...(draft.write === undefined ? {} : { write: draft.write }),
      ownerType: targetType,
      ownerTypeParameters: definition.typeParameters,
    }))),
    constructors: Object.freeze(constructors),
    heritage,
    targetType,
    polymorphic: input.projectRelationships.isPolymorphic(definition),
    stateStorage: "direct",
  });
  return Object.freeze({
    class_,
    callables: Object.freeze([...constructors, ...methods, ...accessors]),
    fields: class_.fields,
  });
}

function allocateCallableName(
  allocated: Map<string, string>,
  allocate: (name: string) => string,
  key: string,
  requested: string,
): string {
  const existing = allocated.get(key);
  if (existing !== undefined) return existing;
  const selected = allocate(requested);
  allocated.set(key, selected);
  return selected;
}

function signatureInput(
  input: MojoClassAnalysisInput,
  declaration: Node,
  body: Node,
  name: string,
  allocateLocalName: (sourceName: string) => string,
) {
  return {
    ...callableSignatureInput(input, declaration, name, allocateLocalName),
    body,
  };
}

function callableSignatureInput(
  input: MojoClassAnalysisInput,
  declaration: Node,
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
    allocateLocalName,
    bindingNames: input.bindingNames,
    bindingTypes: input.bindingTypes,
    diagnostics: input.diagnostics,
  };
}

function selectedConstructorCallable(
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

function constructorImplementationCallable(
  input: MojoClassAnalysisInput,
  declaration: Node,
): SourceCallableTypeEvidence | undefined {
  const { ast } = input.source;
  const semantics = input.source.semantics.forFile(input.sourceFile);
  const parameters: SourceCallableTypeEvidence["parameters"][number][] = [];
  for (const parameter of ast.parameters(declaration)) {
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
      reference?.symbol === undefined || type === undefined) {
      append(
        input,
        "MOJO_CONSTRUCTOR_IMPLEMENTATION_PARAMETER_UNRESOLVED",
        "A constructor implementation parameter requires exact syntax, symbol, and checker type evidence.",
        parameter ?? declaration,
      );
      return undefined;
    }
    const syntax = ast.as.AsParameterDeclaration(parameter)!;
    const rest = syntax.DotDotDotToken !== undefined;
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
  const resultType = semantics.declarations.declaredType(input.declaration);
  if (resultType === undefined) {
    append(
      input,
      "MOJO_CONSTRUCTOR_RESULT_TYPE_UNRESOLVED",
      "The checker supplied no exact project class instance type.",
      declaration,
    );
    return undefined;
  }
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
  });
  if (result.kind === "resolved") return result.type;
  append(input, "MOJO_CLASS_FIELD_CARRIER_UNRESOLVED", `Selected class field type cannot be represented exactly in Mojo: ${result.reason}.`, node);
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
