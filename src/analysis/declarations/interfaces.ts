import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import {
  analyzeMojoCallableSignature,
  analyzeMojoTypeParameters,
} from "../callables/signatures.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedAccessorProperty,
  MojoAnalyzedCallableSignature,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedInterfaceIndexSignature,
} from "../program/model.js";
import type {
  MojoProjectTypeCatalog,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { mojoGenericParameterReference } from "../../target-model/types/constructors.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import { mojoProjectMethodName } from "./well-known-methods.js";

export interface MojoInterfaceAnalysisInput {
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
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly diagnostics: TargetDiagnostic[];
  readonly createNameAllocator: () => (name: string) => string;
}

export function analyzeMojoInterface(
  input: MojoInterfaceAnalysisInput,
): MojoAnalyzedInterface | undefined {
  const { source, declaration } = input;
  const { ast } = source;
  const definition = input.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "interface") {
    append(input, "MOJO_INTERFACE_IDENTITY_UNRESOLVED", "Interface lowering requires one exact project-interface identity.", declaration);
    return undefined;
  }
  const heritage = input.projectRelationships.heritageForDefinition(definition);
  const targetArguments = definition.typeParameters.map(mojoGenericParameterReference);
  const targetType = input.projectTypes.targetTypeForDefinition(definition, targetArguments);
  if (targetType === undefined) {
    append(input, "MOJO_INTERFACE_TYPE_NOT_CLOSED", "Interface generic parameters do not close its exact Mojo carrier.", declaration);
    return undefined;
  }
  const members = ast.members(declaration);
  if (members.some((member) => member === undefined)) {
    append(input, "MOJO_INTERFACE_MEMBER_EVIDENCE_INCOMPLETE", "Interface members require a dense source AST.", declaration);
    return undefined;
  }
  const fields: MojoAnalyzedInterfaceField[] = [];
  const indexSignatures: MojoAnalyzedInterfaceIndexSignature[] = [];
  const methods: MojoAnalyzedCallableSignature[] = [];
  const accessors: MojoAnalyzedCallableSignature[] = [];
  const accessorDrafts = new Map<string, {
    readonly declarations: Node[];
    readonly sourceName: string;
    read?: MojoAnalyzedCallableSignature;
    write?: MojoAnalyzedCallableSignature;
  }>();
  const allocatedNames = new Map<string, string>();
  let analyzedMemberCount = 0;
  const names = input.createNameAllocator();
  const semantics = source.semantics.forFile(input.sourceFile);
  for (const member of members as readonly Node[]) {
    if (ast.is.IsIndexSignatureDeclaration(member)) {
      const parameters = ast.parameters(member);
      const parameter = parameters.length === 1 ? parameters[0] : undefined;
      if (parameter === undefined || !ast.is.IsParameterDeclaration(parameter)) {
        append(input, "MOJO_INTERFACE_INDEX_PARAMETER_UNRESOLVED", "An interface index signature requires one exact parameter declaration.", member);
        continue;
      }
      const key = declaredType(parameter, semantics, ast);
      const value = declaredType(member, semantics, ast);
      const resolvedKey = resolveInterfaceType(input, key, ast.typeNode(parameter), parameter);
      const resolvedValue = resolveInterfaceType(input, value, ast.typeNode(member), member);
      if (resolvedKey === undefined || resolvedValue === undefined) continue;
      const indexSignature = Object.freeze({
        kind: "interface-index-signature" as const,
        declaration: member,
        storageName: names("_index"),
        keyType: resolvedKey,
        valueType: resolvedValue,
        ownerType: targetType,
        ownerTypeParameters: definition.typeParameters,
        readonly: ast.hasModifierKind(member, "readonly"),
      });
      indexSignatures.push(indexSignature);
      input.bindingTypes.set(member, resolvedValue);
      analyzedMemberCount += 1;
      continue;
    }
    if (ast.is.IsMethodSignatureDeclaration(member)) {
      const nameNode = ast.name(member);
      const sourceName = nameNode === undefined
        ? undefined
        : mojoProjectMethodName(nameNode, semantics, ast);
      if (sourceName === undefined) {
        append(input, "MOJO_INTERFACE_METHOD_NAME_UNSUPPORTED", "Interface methods require one exact identifier or supported well-known-symbol name.", member);
        continue;
      }
      const name = allocateCallableName(allocatedNames, names, `method:${sourceName}`, sourceName);
      const signature = analyzeMojoCallableSignature({
        ...callableSignatureInput(input, member, name),
        kind: "method",
        owner: Object.freeze({ name: input.name, stateName: input.stateName, type: targetType }),
        static: false,
      });
      if (signature === undefined) continue;
      methods.push(signature);
      input.bindingNames.set(member, name);
      analyzedMemberCount += 1;
      continue;
    }
    if (ast.is.IsGetAccessorDeclaration(member) || ast.is.IsSetAccessorDeclaration(member)) {
      const nameNode = ast.name(member);
      if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
        append(input, "MOJO_INTERFACE_ACCESSOR_NAME_UNSUPPORTED", "Interface accessors require one exact identifier name.", member);
        continue;
      }
      const sourceName = ast.text(nameNode);
      const getter = ast.is.IsGetAccessorDeclaration(member);
      const role = getter ? "get" : "set";
      const name = allocateCallableName(
        allocatedNames,
        names,
        `accessor:${sourceName}:${role}`,
        `_${role}_${sourceName}`,
      );
      const signature = analyzeMojoCallableSignature({
        ...callableSignatureInput(input, member, name),
        kind: getter ? "getter" : "setter",
        owner: Object.freeze({ name: input.name, stateName: input.stateName, type: targetType }),
        static: false,
      });
      if (signature === undefined) continue;
      const draft = accessorDrafts.get(sourceName) ?? {
        declarations: [],
        sourceName,
      };
      draft.declarations.push(member);
      if (getter) draft.read = signature;
      else draft.write = signature;
      accessorDrafts.set(sourceName, draft);
      accessors.push(signature);
      input.bindingNames.set(member, name);
      analyzedMemberCount += 1;
      continue;
    }
    if (!ast.is.IsPropertySignatureDeclaration(member)) {
      append(
        input,
        "MOJO_INTERFACE_MEMBER_UNSUPPORTED",
        `Interface member '${ast.kindName(member)}' requires a sealed callable or index representation.`,
        member,
      );
      continue;
    }
    const nameNode = ast.name(member);
    if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
      append(input, "MOJO_INTERFACE_FIELD_NAME_UNSUPPORTED", "Interface fields require one exact identifier name.", member);
      continue;
    }
    const selected = declaredType(member, semantics, ast);
    const resolved = resolveMojoTargetType(selected, ast.typeNode(member), {
      ast,
      navigation: source.navigation,
      semantics,
      sourceFacts: source.sourceFacts,
      providerSemantics: input.providerSemantics,
      projectTypes: input.projectTypes,
      sourceProfiles: input.sourceProfiles,
      jsEnabled: input.jsEnabled,
      ...(input.sourceCallableErrorType === undefined
        ? {}
        : { sourceCallableErrorType: input.sourceCallableErrorType }),
    });
    if (resolved.kind === "unsupported") {
      append(input, "MOJO_TARGET_TYPE_UNSUPPORTED", `Selected interface field type cannot be represented exactly in Mojo: ${resolved.reason}.`, member);
      continue;
    }
    const sourceName = ast.text(nameNode);
    const name = names(sourceName);
    const field = Object.freeze({
      kind: "interface-field" as const,
      declaration: member,
      sourceName,
      name,
      type: resolved.type,
      ownerType: targetType,
      ownerTypeParameters: definition.typeParameters,
      optional: ast.questionToken(member) !== undefined,
      readonly: ast.hasModifierKind(member, "readonly"),
    });
    fields.push(field);
    input.bindingNames.set(member, name);
    input.bindingTypes.set(member, resolved.type);
    analyzedMemberCount += 1;
  }
  if (analyzedMemberCount !== members.length) return undefined;
  const typeParameters = analyzeMojoTypeParameters({
    source,
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
    diagnostics: input.diagnostics,
  });
  if (typeParameters === undefined) return undefined;
  return Object.freeze({
    kind: "interface",
    definition,
    declaration,
    sourceFile: input.sourceFile,
    name: input.name,
    stateName: input.stateName,
    typeParameters,
    fields: Object.freeze(fields),
    indexSignatures: Object.freeze(indexSignatures),
    methods: Object.freeze(methods),
    accessors: Object.freeze(accessors),
    accessorProperties: Object.freeze([...accessorDrafts.values()].map((draft): MojoAnalyzedAccessorProperty => Object.freeze({
      kind: "accessor-property",
      declarations: Object.freeze([...draft.declarations]),
      sourceName: draft.sourceName,
      ...(draft.read === undefined ? {} : { read: draft.read }),
      ...(draft.write === undefined ? {} : { write: draft.write }),
      ownerType: targetType,
      ownerTypeParameters: definition.typeParameters,
    }))),
    heritage,
    targetType,
    polymorphic: methods.length !== 0 || accessors.length !== 0 ||
      input.projectRelationships.isPolymorphic(definition),
    stateStorage: "direct",
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

function callableSignatureInput(
  input: MojoInterfaceAnalysisInput,
  declaration: Node,
  name: string,
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
    allocateLocalName: input.createNameAllocator(),
    bindingNames: input.bindingNames,
    bindingTypes: input.bindingTypes,
    diagnostics: input.diagnostics,
  };
}

function resolveInterfaceType(
  input: MojoInterfaceAnalysisInput,
  type: Type | undefined,
  authoredTypeNode: Node | undefined,
  evidence: Node,
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(type, authoredTypeNode, {
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
  if (resolved.kind === "unsupported") {
    append(input, "MOJO_TARGET_TYPE_UNSUPPORTED", `Selected interface type cannot be represented exactly in Mojo: ${resolved.reason}.`, evidence);
    return undefined;
  }
  return resolved.type;
}

function declaredType(
  declaration: Node,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): Type | undefined {
  const authored = ast.typeNode(declaration);
  return semantics.declarations.declaredValueType(declaration) ??
    semantics.declarations.declaredType(declaration) ??
    (authored === undefined ? undefined : semantics.types.authoredType(authored));
}

function append(
  input: MojoInterfaceAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
