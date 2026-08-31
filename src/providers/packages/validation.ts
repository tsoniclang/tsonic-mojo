import type {
  MojoProviderOperationDefinition,
  MojoProviderPackageDefinition,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";

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
    validateType(type.targetType);
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
  validateType(operation.resultType);
  for (const type of operation.parameterTypes ?? []) validateType(type);
  if (operation.receiverType !== undefined) validateType(operation.receiverType);
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
    if (operation.memberId === undefined || operation.target.kind !== "property-read" ||
      operation.receiverType === undefined) {
      throw new Error(`Provider property '${operation.exportId}' requires an exact member, receiver, and property-read target.`);
    }
  } else if (operation.operationKind === "property-set") {
    if (operation.memberId === undefined || operation.target.kind !== "property-write" ||
      operation.receiverType === undefined || (operation.parameterTypes ?? []).length !== 1) {
      throw new Error(`Provider property write '${operation.exportId}' requires an exact member, receiver, value, and property-write target.`);
    }
  } else {
    throw new Error(`Provider operation kind '${operation.operationKind}' has no current Mojo target form.`);
  }
  if (operation.target.kind === "instance-call" &&
    (operation.memberId === undefined || operation.receiverType === undefined)) {
    throw new Error(`Provider instance call '${operation.exportId}' requires an exact source member and receiver carrier.`);
  }
  if (operation.target.kind === "function-call") {
    if (operation.target.modulePath.length === 0) {
      throw new Error(`Provider operation '${operation.exportId}' has an empty Mojo module path.`);
    }
    for (const segment of operation.target.modulePath) {
      if (!identifierPattern.test(segment)) {
        throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo module segment '${segment}'.`);
      }
    }
    for (const segment of operation.target.ownerPath ?? []) {
      if (!identifierPattern.test(segment)) {
        throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo owner segment '${segment}'.`);
      }
    }
  }
  if (!identifierPattern.test(operation.target.name)) {
    throw new Error(`Provider operation '${operation.exportId}' has invalid Mojo name '${operation.target.name}'.`);
  }
  if (operation.target.kind === "function-call" || operation.target.kind === "instance-call") {
    const genericNames = new Set<string>();
    for (const parameter of operation.target.genericParameters ?? []) {
      if (!identifierPattern.test(parameter.name) || genericNames.has(parameter.name)) {
        throw new Error(`Provider operation '${operation.exportId}' has invalid or duplicate Mojo generic parameter '${parameter.name}'.`);
      }
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
}

function validateType(type: MojoTargetTypeRef): void {
  switch (type.kind) {
    case "source-primitive":
      if (type.name === "decimal" || type.name === "int128" || type.name === "uint128") {
        throw new Error(`Source primitive '${type.name}' has no certified Mojo carrier.`);
      }
      return;
    case "native-string":
    case "unit":
      return;
    case "type-parameter":
      if (!identifierPattern.test(type.name)) throw new Error(`Invalid Mojo type parameter '${type.name}'.`);
      return;
    case "target-named":
      requireText(type.id, "target type id");
      if (!identifierPattern.test(type.name) || type.modulePath.some((part) => !identifierPattern.test(part))) {
        throw new Error(`Target type '${type.id}' has an invalid Mojo path.`);
      }
      for (const argument of type.genericArguments ?? []) {
        if (argument.kind === "type") validateType(argument.type);
        else if (argument.kind === "value") requireText(argument.expression, "target generic value");
      }
      return;
    case "list":
      validateType(type.element);
      return;
    case "optional":
      validateType(type.value);
      return;
    case "tuple":
      for (const element of type.elements) validateType(element);
      return;
    case "reference":
      requireText(type.origin, "reference origin");
      validateType(type.value);
      return;
    case "function":
      for (const parameter of type.parameters) validateType(parameter);
      validateType(type.result);
      return;
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
