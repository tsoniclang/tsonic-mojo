import type {
  ProviderExportDeclaration,
} from "@tsonic/tsts";

export const mojoSourceOperationNames = Object.freeze({
  copyExport: "copy",
  materializeExport: "materialize",
});

export const mojoSourceOperationSignatureIds = Object.freeze({
  copy: "copy<T>(value)",
  materialize: "materialize<T>(value)",
});

export function mojoSourceOperationDeclarations(): readonly ProviderExportDeclaration[] {
  return [
    valueOperationDeclaration(
      mojoSourceOperationNames.copyExport,
      mojoSourceOperationSignatureIds.copy,
    ),
    valueOperationDeclaration(
      mojoSourceOperationNames.materializeExport,
      mojoSourceOperationSignatureIds.materialize,
    ),
  ];
}

function valueOperationDeclaration(
  exportName: string,
  signatureId: string,
): ProviderExportDeclaration {
  const typeParameter = { kind: "type-parameter" as const, name: "T" };
  return Object.freeze({
    id: exportName,
    name: exportName,
    kind: "function",
    signatures: [Object.freeze({
      id: signatureId,
      typeParameters: [Object.freeze({ name: "T" })],
      parameters: [Object.freeze({ name: "value", type: typeParameter })],
      returnType: typeParameter,
    })],
  });
}
