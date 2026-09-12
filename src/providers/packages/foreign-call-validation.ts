import type { ProviderSignatureDeclaration } from "@tsonic/tsts";
import type { MojoProviderOperationDefinition } from "./model.js";
import { isMojoCAbiValue } from "../../policy/operations/c-abi.js";

export function validateMojoForeignCall(operation: MojoProviderOperationDefinition, signature: ProviderSignatureDeclaration | undefined): void {
  const target = operation.target;
  if (target.kind !== "foreign-call") return;
  const reject = (reason: string): never => { throw new Error(`Foreign call '${operation.exportId}': ${reason}`); };
  if (operation.operationKind !== "call" || operation.receiverType !== undefined || operation.raises === true || operation.errorType !== undefined) reject("a C call requires a nonraising, receiver-free call contract");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(target.symbol)) reject("the provider must supply one exact C symbol identifier");
  if (signature === undefined || (signature.typeParameters?.length ?? 0) !== 0) reject("the C signature must have a closed declared ABI");
  const fixed = target.fixedParameterCount;
  if (!Number.isSafeInteger(fixed) || fixed < 0 || fixed > target.arguments.length || target.arguments.length - fixed > 1) reject("invalid C fixed parameter count");
  if (operation.resultType.kind !== "unit" && !isMojoCAbiValue(operation.resultType)) reject("result is not a closed native C scalar or pointer");
  for (const [index, argument] of target.arguments.entries()) {
    const parameter = signature!.parameters[index];
    const rest = index === fixed;
    if (parameter === undefined || parameter.optional === true || (parameter.rest === true) !== rest || (argument.variadic === true) !== rest) reject("source and native C fixed/rest parameters disagree");
    if (argument.convention !== "imm" || argument.position === "keyword" || argument.nativeName !== undefined || argument.restPacking !== undefined ||
      Object.keys(argument).some((key) => !["convention", "position", "variadic"].includes(key))) reject("C values must use unlabelled value arguments, not receiver or collection conventions");
    const type = operation.parameterTypes?.[index];
    if (!rest && (type === undefined || !isMojoCAbiValue(type))) reject("fixed parameter is not a closed native C scalar or pointer");
  }
}
