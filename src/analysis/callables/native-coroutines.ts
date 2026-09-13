import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoNativeErrorType } from "../../target-model/types/error-domains.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";

export function validateMojoNativeCoroutineErrorDomain(
  declaration: Node,
  errorType: MojoTargetTypeRef | undefined,
  diagnostics: TargetDiagnostic[],
): void {
  if (errorType === undefined || mojoTargetTypeEquals(errorType, mojoNativeErrorType())) return;
  diagnostics.push(mojoAnalysisDiagnostic(
    "MOJO_NATIVE_COROUTINE_ERROR_DOMAIN_UNSUPPORTED",
    "The selected native coroutine await ABI carries only native Error; it cannot preserve this exact authored error payload.",
    declaration,
  ));
}
