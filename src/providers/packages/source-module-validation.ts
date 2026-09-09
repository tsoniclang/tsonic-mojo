import type { MojoProviderOperationDefinition } from "./model.js";

export function validateMojoSourceModuleArgument(operation: MojoProviderOperationDefinition): void {
  if (operation.target.kind !== "function-call" || operation.target.sourceModule === undefined) return;
  const contract = operation.target.sourceModule;
  if (contract === null || typeof contract !== "object" || contract.bootstrap === null || typeof contract.bootstrap !== "object") {
    throw new Error(`Provider constructor '${operation.signatureId}' has no valid source-module bootstrap contract.`);
  }
  const index = contract.parameterIndex;
  const type = operation.parameterTypes?.[index];
  const argument = operation.target.arguments[index];
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const bootstrap = contract.bootstrap;
  if (operation.operationKind !== "constructor" || operation.receiverType !== undefined ||
    !Number.isSafeInteger(index) || index < 0 || type?.kind !== "native-string" ||
    argument === undefined || argument.variadic === true || argument.convention !== "imm" ||
    typeof bootstrap.id !== "string" || bootstrap.id.length === 0 ||
    !Array.isArray(bootstrap.modulePath) || bootstrap.modulePath.length === 0 ||
    !bootstrap.modulePath.every((part) => typeof part === "string" && identifier.test(part)) ||
    typeof bootstrap.entryName !== "string" || !identifier.test(bootstrap.entryName) ||
    typeof bootstrap.completeName !== "string" || !identifier.test(bootstrap.completeName)) {
    throw new Error(`Provider constructor '${operation.signatureId}' has an invalid compiled source-module argument or bootstrap contract.`);
  }
}
