import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";

export function mojoProviderCompoundWriteIssue(
  accessMode: "read" | "write" | "read-write" | "delete",
  sourceWriteType: MojoTargetTypeRef | undefined,
  targetWriteType: MojoTargetTypeRef | undefined,
): { readonly kind: "unsupported"; readonly code: string; readonly reason: string } | undefined {
  if (accessMode !== "read-write" || sourceWriteType === undefined || targetWriteType === undefined ||
    mojoTargetTypeEquals(sourceWriteType, targetWriteType)) return undefined;
  return Object.freeze({
    kind: "unsupported",
    code: "MOJO_PROVIDER_COMPOUND_WRITE_CONVERSION_UNSUPPORTED",
    reason: "Provider compound assignment requires an identity source-to-target write conversion.",
  });
}
