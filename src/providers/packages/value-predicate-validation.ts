import type { MojoProviderOperationDefinition } from "./model.js";
import { validateMojoProviderType } from "./type-validation.js";

export function validateMojoValuePredicate(operation: MojoProviderOperationDefinition): void {
  const target = operation.target;
  if (target.kind !== "value-predicate") return;
  const argument = target.arguments[0];
  if (operation.operationKind !== "call" || operation.receiverType !== undefined ||
    operation.parameterTypes?.length !== 1 || target.arguments.length !== 1 ||
    argument?.convention !== "imm" || argument.position === "keyword" ||
    argument.variadic === true || argument.restPacking !== undefined ||
    operation.resultType.kind !== "source-primitive" || operation.resultType.name !== "bool" ||
    operation.errorType !== undefined || operation.raises === true) {
    throw new Error(`Provider value predicate '${operation.exportId}' requires one immutable argument and a non-raising Bool result.`);
  }
  validateMojoProviderType(target.predicate.acceptedType);
  if (target.predicate.acceptedType.kind !== "target-named" ||
    (target.predicate.acceptedType.genericArguments?.length ?? 0) !== 0) {
    throw new Error(`Provider value predicate '${operation.exportId}' requires one exact non-generic native named carrier.`);
  }
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u;
  if (target.predicate.boxed.modulePath.length === 0 ||
    target.predicate.boxed.modulePath.some((segment) => !identifier.test(segment)) ||
    !identifier.test(target.predicate.boxed.name)) {
    throw new Error(`Provider value predicate '${operation.exportId}' requires an exact boxed-value operation.`);
  }
}
