import type {
  MojoProviderOperationDefinition,
  MojoProviderPackageDefinition,
} from "./model.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";
import {
  validateMojoConformanceCondition,
  validateMojoLifecycleRole,
  validateMojoProviderGenericArgument,
  validateMojoProviderType,
} from "./type-validation.js";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

interface ProviderMemberOwner {
  readonly exportId: string;
  readonly declaration: ProviderMemberDeclaration;
}

interface ProviderSignatureOwner {
  readonly exportId: string;
  readonly memberId?: string;
  readonly declaration: ProviderSignatureDeclaration;
}

interface ProviderDeclarationIndex {
  readonly exports: ReadonlyMap<string, ProviderExportDeclaration>;
  readonly members: ReadonlyMap<string, ProviderMemberOwner>;
  readonly signatures: ReadonlyMap<string, ProviderSignatureOwner>;
}

export function validateMojoProviderPackageDefinition(
  definition: MojoProviderPackageDefinition,
): void {
  requireText(definition.id, "id");
  requireText(definition.displayName, "displayName");
  requireText(definition.version, "version");
  const modules = new Map<string, string>();
  const providerModuleIds = new Set<string>();
  const exports = new Map<string, ProviderExportDeclaration>();
  const members = new Map<string, ProviderMemberOwner>();
  const signatures = new Map<string, ProviderSignatureOwner>();
  for (const module of definition.modules) {
    requireText(module.moduleSpecifier, "moduleSpecifier");
    requireText(module.providerModuleId, "providerModuleId");
    if (modules.has(module.moduleSpecifier)) {
      throw new Error(`Provider module '${module.moduleSpecifier}' is duplicated.`);
    }
    modules.set(module.moduleSpecifier, module.providerModuleId);
    if (providerModuleIds.has(module.providerModuleId)) {
      throw new Error(`Provider module identity '${module.providerModuleId}' is duplicated.`);
    }
    providerModuleIds.add(module.providerModuleId);
    const exportNames = new Set<string>();
    for (const exported of module.exports) {
      requireText(exported.id, `export id in '${module.moduleSpecifier}'`);
      if (exports.has(exported.id)) {
        throw new Error(`Provider export '${exported.id}' is duplicated.`);
      }
      if (exportNames.has(exported.name)) {
        throw new Error(`Provider export name '${exported.name}' is duplicated in '${module.moduleSpecifier}'.`);
      }
      exportNames.add(exported.name);
      exports.set(exported.id, exported);
      indexSignatures(exported.signatures ?? [], exported.id, undefined, signatures);
      for (const member of exported.members ?? []) {
        requireText(member.id, `member id on '${exported.id}'`);
        if (members.has(member.id)) {
          throw new Error(`Provider member '${member.id}' is duplicated.`);
        }
        members.set(member.id, { exportId: exported.id, declaration: member });
        indexSignatures(member.signatures ?? [], exported.id, member.id, signatures);
      }
    }
  }
  const aliases = new Set<string>();
  for (const alias of definition.moduleAliases ?? []) {
    requireText(alias.moduleSpecifier, "module alias");
    if (!modules.has(alias.canonicalModuleSpecifier)) {
      throw new Error(`Provider alias '${alias.moduleSpecifier}' targets unknown module '${alias.canonicalModuleSpecifier}'.`);
    }
    if (modules.has(alias.moduleSpecifier)) {
      throw new Error(`Provider alias '${alias.moduleSpecifier}' collides with a canonical module.`);
    }
    if (aliases.has(alias.moduleSpecifier)) {
      throw new Error(`Provider alias '${alias.moduleSpecifier}' is duplicated.`);
    }
    aliases.add(alias.moduleSpecifier);
  }
  const declarations: ProviderDeclarationIndex = { exports, members, signatures };
  const operationIds = new Set<string>();
  for (const operation of definition.operations) {
    validateOperation(operation, declarations);
    const identity = [
      operation.exportId,
      operation.memberId ?? "",
      operation.signatureId ?? "",
      operation.operationKind,
    ].join("\0");
    if (operationIds.has(identity)) {
      throw new Error(`Provider operation '${identity}' is duplicated.`);
    }
    operationIds.add(identity);
  }
  const typeExports = new Set<string>();
  for (const type of definition.types ?? []) {
    if (!exports.has(type.exportId)) {
      throw new Error(`Provider type '${type.exportId}' has no exported declaration.`);
    }
    if (typeExports.has(type.exportId)) {
      throw new Error(`Provider type relation '${type.exportId}' is duplicated.`);
    }
    typeExports.add(type.exportId);
    const sourceGenericNames = new Set<string>();
    for (const parameter of type.sourceGenericParameters) {
      if (!identifierPattern.test(parameter.targetName) || sourceGenericNames.has(parameter.targetName)) {
        throw new Error(
          `Provider type '${type.exportId}' has invalid or duplicate target generic parameter '${parameter.targetName}'.`,
        );
      }
      if (typeof parameter.variadic !== "boolean") {
        throw new Error(
          `Provider type '${type.exportId}' has no exact variadic contract for '${parameter.targetName}'.`,
        );
      }
      sourceGenericNames.add(parameter.targetName);
    }
    validateMojoProviderType(type.targetType);
    for (const conformance of type.conformances ?? []) {
      validateMojoProviderType(conformance.trait);
      if (conformance.lifecycleRole !== undefined) {
        validateMojoLifecycleRole(conformance.lifecycleRole, `provider type '${type.exportId}'`);
      }
      if (conformance.condition !== undefined) {
        validateMojoConformanceCondition(conformance.condition, type.exportId);
      }
    }
    for (const alias of type.associatedAliases ?? []) {
      if (!identifierPattern.test(alias.name)) {
        throw new Error(`Provider type '${type.exportId}' has an invalid associated alias.`);
      }
      for (const parameter of alias.genericParameters) {
        if (!identifierPattern.test(parameter.name)) {
          throw new Error(`Provider type '${type.exportId}' has an invalid associated alias generic parameter.`);
        }
        for (const constraint of parameter.constraints) validateMojoProviderType(constraint);
        if (parameter.defaultArgument !== undefined) validateMojoProviderGenericArgument(parameter.defaultArgument);
      }
      if (alias.category !== "type" && alias.category !== "value" && alias.category !== "origin") {
        throw new Error(`Provider type '${type.exportId}' has an invalid associated alias category.`);
      }
      if (alias.abstract && (alias.category !== "type" || alias.targetType !== undefined ||
        alias.valueType !== undefined || alias.valueExpression !== undefined)) {
        throw new Error(`Provider type '${type.exportId}' has an invalid abstract associated alias.`);
      }
      if (!alias.abstract && alias.category === "type" &&
        (alias.targetType === undefined || alias.valueType !== undefined)) {
        throw new Error(`Provider type '${type.exportId}' has an incomplete type-alias contract.`);
      }
      if (!alias.abstract && alias.category !== "type" &&
        (alias.targetType !== undefined || alias.valueType === undefined)) {
        throw new Error(`Provider type '${type.exportId}' has an incomplete value-alias contract.`);
      }
      if (alias.targetType !== undefined) validateMojoProviderType(alias.targetType);
      if (alias.valueType !== undefined) validateMojoProviderType(alias.valueType);
      if (!alias.abstract) {
        if (alias.valueExpression === undefined) {
          throw new Error(`Provider type '${type.exportId}' has no associated alias value.`);
        }
        requireText(alias.valueExpression, `associated alias value on '${type.exportId}'`);
      }
    }
    if (type.objectLiteralConstruction !== undefined &&
      (type.objectLiteralConstruction.kind !== "struct-default" ||
        Object.keys(type.objectLiteralConstruction).length !== 1 ||
        type.targetType.kind !== "target-named")) {
      throw new Error(`Provider type '${type.exportId}' has an invalid object-literal construction contract.`);
    }
  }
  const epilogueIds = new Set<string>();
  for (const epilogue of definition.binaryEpilogues ?? []) {
    requireText(epilogue.id, "binary epilogue identity");
    if (epilogueIds.has(epilogue.id) || epilogue.modulePath.length === 0 ||
      !identifierPattern.test(epilogue.name) ||
      epilogue.modulePath.some((segment) => !identifierPattern.test(segment))) {
      throw new Error(`Mojo binary epilogue '${epilogue.id}' has an invalid or duplicate target identity.`);
    }
    epilogueIds.add(epilogue.id);
  }
  const runtimeNames = new Set<string>();
  for (const runtime of definition.runtimePackages) {
    if (!identifierPattern.test(runtime.packageName)) {
      throw new Error(`Mojo runtime package name '${runtime.packageName}' is invalid.`);
    }
    requireText(runtime.packagePath, `runtime path for '${runtime.packageName}'`);
    if (runtimeNames.has(runtime.packageName)) {
      throw new Error(`Mojo runtime package '${runtime.packageName}' is duplicated.`);
    }
    runtimeNames.add(runtime.packageName);
  }
}

function validateOperation(
  operation: MojoProviderOperationDefinition,
  declarations: ProviderDeclarationIndex,
): void {
  if (!declarations.exports.has(operation.exportId)) {
    throw new Error(`Provider operation '${operation.exportId}' has no exported declaration.`);
  }
  if (operation.memberId !== undefined) {
    const member = declarations.members.get(operation.memberId);
    if (member === undefined || member.exportId !== operation.exportId) {
      throw new Error(`Provider operation member '${operation.memberId}' is not owned by export '${operation.exportId}'.`);
    }
  }
  const signature = operation.signatureId === undefined
    ? undefined
    : declarations.signatures.get(operation.signatureId);
  if (operation.signatureId !== undefined &&
    (signature === undefined || signature.exportId !== operation.exportId ||
      signature.memberId !== operation.memberId)) {
    throw new Error(`Provider operation signature '${operation.signatureId}' is not owned by its declared export/member identity.`);
  }
  validateMojoProviderType(operation.resultType);
  for (const type of operation.parameterTypes ?? []) validateMojoProviderType(type);
  if (operation.receiverType !== undefined) validateMojoProviderType(operation.receiverType);
  if (operation.errorType !== undefined) {
    if (operation.raises !== true) {
      throw new Error(`Provider operation '${operation.exportId}' has an error type but is not raising.`);
    }
    validateMojoProviderType(operation.errorType);
  }
  if (operation.operationKind === "call" || operation.operationKind === "constructor") {
    if (signature === undefined) {
      throw new Error(`Provider ${operation.operationKind} '${operation.exportId}' requires an exact signature identity.`);
    }
    if (operation.target.kind !== "function-call" && operation.target.kind !== "instance-call") {
      throw new Error(`Provider ${operation.operationKind} '${operation.exportId}' requires a Mojo call target.`);
    }
    const parameters = operation.parameterTypes ?? [];
    if (parameters.length !== signature.declaration.parameters.length ||
      parameters.length !== operation.target.arguments.length) {
      throw new Error(`Provider ${operation.operationKind} '${operation.signatureId}' has inconsistent source, target, and ABI arity.`);
    }
  } else if (operation.operationKind === "property") {
    const memberProperty = operation.memberId !== undefined &&
      operation.target.kind === "property-read" &&
      operation.receiverType !== undefined;
    const staticMemberProperty = operation.memberId !== undefined &&
      operation.target.kind === "function-read" &&
      operation.receiverType === undefined &&
      (operation.parameterTypes ?? []).length === 0 &&
      declarations.members.get(operation.memberId)?.declaration.static === true;
    const exported = declarations.exports.get(operation.exportId)!;
    const moduleConstant = operation.memberId === undefined &&
      operation.signatureId === undefined &&
      (operation.target.kind === "constant" || operation.target.kind === "function-read") &&
      operation.receiverType === undefined &&
      (operation.parameterTypes ?? []).length === 0 &&
      exported.kind === "value";
    if (!memberProperty && !staticMemberProperty && !moduleConstant) {
      throw new Error(`Provider property '${operation.exportId}' requires an exact member, receiver, and property-read target.`);
    }
  } else if (operation.operationKind === "property-set") {
    const member = operation.memberId === undefined
      ? undefined
      : declarations.members.get(operation.memberId)?.declaration;
    const instanceWrite = operation.target.kind === "property-write" &&
      operation.receiverType !== undefined;
    const staticWrite = operation.target.kind === "function-write" &&
      operation.receiverType === undefined && member?.static === true;
    if (operation.memberId === undefined || (!instanceWrite && !staticWrite) ||
      member?.readonly === true || (operation.parameterTypes ?? []).length !== 1) {
      throw new Error(`Provider property write '${operation.exportId}' requires an exact member, receiver, value, and property-write target.`);
    }
  } else if (operation.operationKind === "indexer") {
    const member = operation.memberId === undefined ? undefined : declarations.members.get(operation.memberId);
    if (member?.declaration.kind !== "indexer" || signature === undefined ||
      operation.target.kind !== "index-read" || operation.receiverType === undefined ||
      (operation.parameterTypes ?? []).length !== 1 || signature.declaration.parameters.length !== 1) {
      throw new Error(`Provider indexer '${operation.exportId}' requires an exact index signature, receiver, index, and index-read target.`);
    }
  } else if (operation.operationKind === "index-set") {
    const member = operation.memberId === undefined ? undefined : declarations.members.get(operation.memberId);
    if (member?.declaration.kind !== "indexer" || member.declaration.readonly === true || signature === undefined ||
      operation.target.kind !== "index-write" || operation.receiverType === undefined ||
      (operation.parameterTypes ?? []).length !== 2 || signature.declaration.parameters.length !== 1 ||
      operation.resultType.kind !== "unit") {
      throw new Error(`Provider index write '${operation.exportId}' requires a writable exact index signature, receiver, index, value, and unit result.`);
    }
  } else {
    throw new Error(`Provider operation kind '${operation.operationKind}' has no current Mojo target form.`);
  }
  if (operation.target.kind === "instance-call" &&
    (operation.memberId === undefined || operation.receiverType === undefined)) {
    throw new Error(`Provider instance call '${operation.exportId}' requires an exact source member and receiver carrier.`);
  }
  if (operation.target.kind === "function-call" &&
    (operation.target.receiver === undefined) !== (operation.receiverType === undefined)) {
    throw new Error(
      `Provider function call '${operation.exportId}' must declare both or neither of its helper receiver ABI and receiver carrier.`,
    );
  }
  if (operation.target.kind === "function-call" || operation.target.kind === "constant" ||
    operation.target.kind === "function-read" || operation.target.kind === "function-write") {
    if (operation.target.modulePath.length === 0) {
      throw new Error(`Provider operation '${operation.exportId}' has an empty Mojo module path.`);
    }
    for (const segment of operation.target.modulePath) {
      if (!identifierPattern.test(segment)) {
        throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo module segment '${segment}'.`);
      }
    }
    if (operation.target.kind === "function-call") {
      for (const segment of operation.target.ownerPath ?? []) {
        if (!identifierPattern.test(segment)) {
          throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo owner segment '${segment}'.`);
        }
      }
    }
  }
  const targetName = "name" in operation.target
    ? operation.target.name
    : "access" in operation.target && operation.target.access.kind !== "element"
      ? operation.target.access.name
      : undefined;
  if (targetName !== undefined && !identifierPattern.test(targetName)) {
    throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo name '${targetName}'.`);
  }
  if (operation.target.kind === "function-call" || operation.target.kind === "instance-call") {
    const genericNames = new Set<string>();
    for (const parameter of operation.target.genericParameters ?? []) {
      if (!identifierPattern.test(parameter.name) || genericNames.has(parameter.name)) {
        throw new Error(`Provider operation '${operation.exportId}' has invalid or duplicate Mojo generic parameter '${parameter.name}'.`);
      }
      for (const constraint of parameter.constraints) validateMojoProviderType(constraint);
      if (parameter.defaultArgument !== undefined) validateMojoProviderGenericArgument(parameter.defaultArgument);
      genericNames.add(parameter.name);
    }
    for (const argument of operation.target.arguments) {
      if (argument.position === "keyword" && argument.nativeName === undefined) {
        throw new Error(`Provider operation '${operation.exportId}' has a keyword argument without its exact Mojo name.`);
      }
      if (argument.nativeName !== undefined && !identifierPattern.test(argument.nativeName)) {
        throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo argument name '${argument.nativeName}'.`);
      }
    }
  }
  if (operation.target.kind === "property-write") {
    if (operation.target.value.position === "keyword" && operation.target.value.nativeName === undefined) {
      throw new Error(`Provider property write '${operation.exportId}' has a keyword value without its exact Mojo name.`);
    }
  }
  if (operation.target.kind === "function-write") {
    validateOperationArgument(operation.target.value, operation.exportId, "value");
  }
  if (operation.target.kind === "index-read" || operation.target.kind === "index-write") {
    validateOperationArgument(operation.target.index, operation.exportId, "index");
    if (operation.target.kind === "index-write") {
      validateOperationArgument(operation.target.value, operation.exportId, "value");
    }
  }
}

function validateOperationArgument(
  argument: import("../../target-model/types/model.js").MojoProviderTargetArgument,
  exportId: string,
  role: string,
): void {
  if (argument.variadic === true) {
    throw new Error(`Provider operation '${exportId}' has a variadic ${role} operand.`);
  }
  if (argument.position === "keyword" && argument.nativeName === undefined) {
    throw new Error(`Provider operation '${exportId}' has a keyword ${role} operand without its exact Mojo name.`);
  }
  if (argument.nativeName !== undefined && !identifierPattern.test(argument.nativeName)) {
    throw new Error(`Provider operation '${exportId}' has invalid Mojo ${role} name '${argument.nativeName}'.`);
  }
}

function indexSignatures(
  declarations: readonly ProviderSignatureDeclaration[],
  exportId: string,
  memberId: string | undefined,
  signatures: Map<string, ProviderSignatureOwner>,
): void {
  for (const declaration of declarations) {
    requireText(declaration.id, `signature id on '${memberId ?? exportId}'`);
    if (signatures.has(declaration.id)) {
      throw new Error(`Provider signature '${declaration.id}' is duplicated.`);
    }
    signatures.set(declaration.id, {
      exportId,
      ...(memberId === undefined ? {} : { memberId }),
      declaration,
    });
  }
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Provider ${field} must be non-empty text.`);
  }
}
