import type {
  ProviderDeclarationModel,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";

export function collectUnboundSameModuleProviderReferences(
  model: ProviderDeclarationModel,
): readonly string[] {
  const boundNames = new Set<string>();
  for (const declaration of model.exports) {
    boundNames.add(declaration.name);
    boundNames.add(declaration.exportName ?? declaration.name);
  }
  const references = new Set<string>();
  const collectType = (type: ProviderTypeExpression): void => {
    switch (type.kind) {
      case "any":
      case "unknown":
      case "void":
      case "never":
      case "undefined":
      case "boolean":
      case "string":
      case "number":
      case "bigint":
      case "object":
      case "source-primitive":
      case "type-parameter":
      case "literal":
        return;
      case "source-global":
        for (const argument of type.typeArguments ?? []) collectType(argument);
        return;
      case "array":
        collectType(type.elementType);
        return;
      case "tuple":
        for (const element of type.elementTypes) collectType(element);
        return;
      case "union":
      case "intersection":
        for (const member of type.types) collectType(member);
        return;
      case "function":
        collectTypeParameters(type.typeParameters ?? []);
        collectParameters(type.parameters);
        collectType(type.returnType);
        return;
      case "provider-ref":
        if (type.moduleSpecifier === model.moduleSpecifier && !boundNames.has(type.exportName)) {
          references.add(type.exportName);
        }
        for (const argument of type.typeArguments ?? []) collectType(argument);
    }
  };
  const collectTypeParameters = (parameters: readonly ProviderTypeParameterDeclaration[]): void => {
    for (const parameter of parameters) {
      for (const constraint of parameter.constraints ?? []) collectType(constraint);
      if (parameter.defaultType !== undefined) collectType(parameter.defaultType);
    }
  };
  const collectParameters = (parameters: readonly ProviderParameterDeclaration[]): void => {
    for (const parameter of parameters) {
      collectType(parameter.type);
      if (parameter.defaultType !== undefined) collectType(parameter.defaultType);
    }
  };
  const collectSignatures = (signatures: readonly ProviderSignatureDeclaration[]): void => {
    for (const signature of signatures) {
      collectTypeParameters(signature.typeParameters ?? []);
      collectParameters(signature.parameters);
      if (signature.returnType !== undefined) collectType(signature.returnType);
    }
  };
  for (const declaration of model.exports) {
    if (declaration.type !== undefined) collectType(declaration.type);
    collectTypeParameters(declaration.typeParameters ?? []);
    for (const heritage of declaration.heritage ?? []) collectType(heritage.type);
    collectSignatures(declaration.signatures ?? []);
    for (const member of declaration.members ?? []) {
      if (member.type !== undefined) collectType(member.type);
      collectSignatures(member.signatures ?? []);
    }
  }
  return Object.freeze([...references].sort(compareText));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
