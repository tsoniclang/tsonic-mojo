import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoTypeParameters } from "../callables/signatures.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedInterfaceIndexSignature,
} from "../program/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { mojoGenericParameterReference } from "../../target-model/types/constructors.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";

export interface MojoInterfaceAnalysisInput {
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
  const heritage = source.navigation.declaredHeritage(declaration);
  if (heritage.kind === "unresolved") {
    append(input, "MOJO_INTERFACE_HERITAGE_UNRESOLVED", heritage.reason, heritage.heritage);
    return undefined;
  }
  if (heritage.edges.length !== 0) {
    append(input, "MOJO_INTERFACE_HERITAGE_UNSUPPORTED", "Interface heritage requires a sealed Mojo object-representation plan.", declaration);
    return undefined;
  }
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
    });
    fields.push(field);
    input.bindingNames.set(member, name);
    input.bindingTypes.set(member, resolved.type);
  }
  if (fields.length + indexSignatures.length !== members.length) return undefined;
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
    declaration,
    sourceFile: input.sourceFile,
    name: input.name,
    stateName: input.stateName,
    typeParameters,
    fields: Object.freeze(fields),
    indexSignatures: Object.freeze(indexSignatures),
    targetType,
    stateStorage: "direct",
  });
}

function resolveInterfaceType(
  input: MojoInterfaceAnalysisInput,
  type: Type | undefined,
  authoredTypeNode: Node | undefined,
  evidence: Node,
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(type, authoredTypeNode, {
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
