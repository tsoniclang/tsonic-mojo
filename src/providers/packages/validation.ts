import type {
  MojoProviderOperationDefinition,
  MojoProviderPackageDefinition,
} from "./model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
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
    validateType(type.targetType);
    for (const conformance of type.conformances ?? []) {
      validateType(conformance.trait);
      if (conformance.condition !== undefined) {
        validateConformanceCondition(conformance.condition, type.exportId);
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
        for (const constraint of parameter.constraints) validateType(constraint);
        if (parameter.defaultArgument !== undefined) validateGenericArgument(parameter.defaultArgument);
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
      if (alias.targetType !== undefined) validateType(alias.targetType);
      if (alias.valueType !== undefined) validateType(alias.valueType);
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
      for (const constraint of parameter.constraints) validateType(constraint);
      if (parameter.defaultArgument !== undefined) validateGenericArgument(parameter.defaultArgument);
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

function validateType(type: MojoTargetTypeRef): void {
  switch (type.kind) {
    case "source-primitive":
      if (type.name === "decimal" || type.name === "int128" || type.name === "uint128") {
        throw new Error(`Source primitive '${type.name}' has no certified Mojo carrier.`);
      }
      return;
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "bigint":
    case "symbol":
      return;
    case "dynamic":
      return;
    case "compiler-expression":
      requireText(type.expression, "Mojo compiler-owned type expression");
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
        validateGenericArgument(argument, `target type '${type.id}'`);
      }
      return;
    case "list":
      validateType(type.element);
      return;
    case "fixed-array":
      validateType(type.element);
      if (type.length.kind === "integer") {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(type.length.value)) {
          throw new Error(`Mojo fixed-array length '${type.length.value}' is not a canonical non-negative integer.`);
        }
      } else if (type.length.kind === "parameter" && !identifierPattern.test(type.length.name)) {
        throw new Error(`Mojo fixed-array length parameter '${type.length.name}' is invalid.`);
      }
      return;
    case "dictionary":
      validateType(type.key);
      validateType(type.value);
      return;
    case "future":
      validateType(type.output);
      return;
    case "optional":
      validateType(type.value);
      return;
    case "union":
      if (type.members.length < 2) {
        throw new Error("Mojo union target type requires at least two member carriers.");
      }
      for (const member of type.members) validateType(member);
      return;
    case "tuple":
      for (const element of type.elements) validateType(element);
      return;
    case "associated":
      validateType(type.owner);
      if (type.memberPath.length === 0 || type.memberPath.some((part) => !identifierPattern.test(part))) {
        throw new Error("Mojo associated target type has an invalid member path.");
      }
      for (const argument of type.genericArguments) {
        validateGenericArgument(argument, "associated target type");
      }
      return;
    case "reference":
      requireText(type.origin, "reference origin");
      validateType(type.value);
      return;
    case "callable":
      for (const parameter of type.parameters) {
        if (parameter.name !== undefined && !identifierPattern.test(parameter.name)) {
          throw new Error(`Invalid Mojo callable parameter '${parameter.name}'.`);
        }
        validateType(parameter.type);
      }
      validateType(type.result);
      return;
    case "function":
      for (const parameter of type.genericParameters) {
        if (!identifierPattern.test(parameter.name)) {
          throw new Error(`Invalid Mojo function generic parameter '${parameter.name}'.`);
        }
        for (const constraint of parameter.constraints) validateType(constraint);
        if (parameter.defaultArgument !== undefined) validateGenericArgument(parameter.defaultArgument);
      }
      for (const parameter of type.parameters) {
        if (parameter.name !== undefined && !identifierPattern.test(parameter.name)) {
          throw new Error(`Invalid Mojo function parameter '${parameter.name}'.`);
        }
        validateType(parameter.type);
      }
      validateType(type.result);
      if (type.errorType !== undefined) validateType(type.errorType);
      if (type.capture !== undefined) requireText(type.capture, "function capture origin");
      return;
  }
}

function validateConformanceCondition(
  condition: import("../../target-model/types/model.js").MojoTargetConformanceCondition,
  exportId: string,
): void {
  switch (condition.kind) {
    case "boolean": return;
    case "conforms-to":
      if (!identifierPattern.test(condition.subject) || condition.traitNames.length === 0 ||
        condition.traitNames.some((name) => !identifierPattern.test(name))) {
        throw new Error(`Provider type '${exportId}' has an invalid conforms-to condition.`);
      }
      return;
    case "predicate":
      validateConditionValue(condition.value, exportId);
      return;
    case "equals":
      validateConditionValue(condition.left, exportId);
      validateConditionValue(condition.right, exportId);
      return;
    case "not":
      validateConformanceCondition(condition.operand, exportId);
      return;
    case "all":
    case "any":
      if (condition.operands.length < 2) {
        throw new Error(`Provider type '${exportId}' has a degenerate boolean conformance condition.`);
      }
      for (const operand of condition.operands) validateConformanceCondition(operand, exportId);
      return;
    case "conditional":
      validateConformanceCondition(condition.condition, exportId);
      validateConformanceCondition(condition.whenTrue, exportId);
      validateConformanceCondition(condition.whenFalse, exportId);
      return;
  }
}

function validateConditionValue(
  value: import("../../target-model/types/model.js").MojoTargetConditionValue,
  exportId: string,
): void {
  const path = value.kind === "path" ? value.segments : value.receiver;
  if (path.length === 0 || path.some((part) => !identifierPattern.test(part)) ||
    (value.kind === "generic-call" &&
      (value.typeArguments.length === 0 || value.typeArguments.some((part) => !identifierPattern.test(part))))) {
    throw new Error(`Provider type '${exportId}' has an invalid conformance condition value.`);
  }
}

function validateGenericArgument(argument: MojoTargetGenericArgument, owner = "provider operation"): void {
  if (argument.name !== undefined && !identifierPattern.test(argument.name)) {
    throw new Error(`Mojo ${owner} has an invalid named generic argument.`);
  }
  if (argument.kind === "type") validateType(argument.type);
  else if (argument.kind === "type-expression" || argument.kind === "compiler-expression") {
    requireText(argument.expression, "target generic value");
  } else if (argument.kind === "static-string") {
    requireText(argument.value, "target static-string generic value");
  } else if (argument.kind === "integer") {
    if (!/^-?[0-9]+$/u.test(argument.value)) {
      throw new Error("Mojo target integer generic value is not an exact integer literal.");
    }
  } else if (argument.kind === "value-reference" &&
    (argument.path.length === 0 || argument.path.some((part) => !identifierPattern.test(part)))) {
    throw new Error("Mojo target generic value reference is not an exact identifier path.");
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
