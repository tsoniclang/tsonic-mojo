import type {
  MojoAnalyzedClass,
  MojoAnalyzedDeclaration,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedModule,
  MojoAnalyzedParameter,
} from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export function mojoRepresentationRootTypes(
  declarations: readonly MojoAnalyzedDeclaration[],
  modules: readonly MojoAnalyzedModule[],
): readonly MojoTargetTypeRef[] {
  return Object.freeze([
    ...declarations.flatMap(declarationTypes),
    ...modules.flatMap((module) => [
      ...module.bindings.map((binding) => binding.type),
      ...(module.errorType === undefined ? [] : [module.errorType]),
    ]),
  ]);
}

export function mojoRepresentationParameters(
  declarations: readonly MojoAnalyzedDeclaration[],
): readonly MojoAnalyzedParameter[] {
  return Object.freeze(declarations.flatMap((declaration) => {
    if (declaration.kind === "function") return declaration.parameters;
    if (declaration.kind === "class") {
      return [
        ...declaration.methods.flatMap((method) => method.parameters),
        ...declaration.accessors.flatMap((accessor) => accessor.parameters),
        ...declaration.constructors.flatMap((constructor) => constructor.parameters),
      ];
    }
    if (declaration.kind === "interface") {
      return [
        ...declaration.methods.flatMap((method) => method.parameters),
        ...declaration.accessors.flatMap((accessor) => accessor.parameters),
      ];
    }
    return [];
  }));
}

function declarationTypes(declaration: MojoAnalyzedDeclaration): readonly MojoTargetTypeRef[] {
  switch (declaration.kind) {
    case "function": return functionTypes(declaration);
    case "class": return classTypes(declaration);
    case "interface": return interfaceTypes(declaration);
    case "type-alias": return Object.freeze([
      declaration.value,
      ...declaration.typeParameters.flatMap((parameter) => parameter.constraints),
    ]);
    case "enum": return Object.freeze([
      declaration.targetType,
      ...declaration.members.map((member) => member.owner),
    ]);
  }
  const exhaustiveDeclaration: never = declaration;
  return exhaustiveDeclaration;
}

function functionTypes(function_: MojoAnalyzedFunction): readonly MojoTargetTypeRef[] {
  return Object.freeze([
    function_.resultType,
    ...function_.parameters.flatMap((parameter) => [
      parameter.type,
      parameter.bodyType,
      parameter.callType,
    ]),
    ...function_.typeParameters.flatMap((parameter) => parameter.constraints),
    ...(function_.errorType === undefined ? [] : [function_.errorType]),
    ...(function_.owner === undefined ? [] : [function_.owner.type]),
  ]);
}

function classTypes(class_: MojoAnalyzedClass): readonly MojoTargetTypeRef[] {
  return Object.freeze([
    class_.targetType,
    ...class_.typeParameters.flatMap((parameter) => parameter.constraints),
    ...class_.fields.flatMap((field) => [field.type, field.ownerType]),
    ...class_.methods.flatMap(functionTypes),
    ...class_.accessors.flatMap(functionTypes),
    ...class_.callableContracts.flatMap(callableTypes),
    ...class_.constructors.flatMap(functionTypes),
    ...(class_.initializationErrorType === undefined ? [] : [class_.initializationErrorType]),
  ]);
}

function interfaceTypes(interface_: MojoAnalyzedInterface): readonly MojoTargetTypeRef[] {
  return Object.freeze([
    interface_.targetType,
    ...interface_.typeParameters.flatMap((parameter) => parameter.constraints),
    ...interface_.fields.flatMap((field) => [field.type, field.ownerType]),
    ...interface_.indexSignatures.flatMap((signature) => [
      signature.keyType,
      signature.valueType,
      signature.ownerType,
    ]),
    ...interface_.methods.flatMap(callableTypes),
    ...interface_.accessors.flatMap(callableTypes),
  ]);
}

function callableTypes(
  callable: import("../program/model.js").MojoAnalyzedCallableSignature,
): readonly MojoTargetTypeRef[] {
  return Object.freeze([
    callable.resultType,
    ...callable.parameters.flatMap((parameter) => [
      parameter.type,
      parameter.bodyType,
      parameter.callType,
    ]),
    ...callable.typeParameters.flatMap((parameter) => parameter.constraints),
    ...(callable.errorType === undefined ? [] : [callable.errorType]),
    ...(callable.owner === undefined ? [] : [callable.owner.type]),
  ]);
}
