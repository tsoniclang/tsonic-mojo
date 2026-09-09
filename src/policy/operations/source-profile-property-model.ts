import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export interface MojoSourceProfilePropertyAccessPolicy {
  readonly read:
    | { readonly kind: "member" | "method"; readonly name: string }
    | { readonly kind: "function"; readonly modulePath: readonly string[]; readonly name: string };
  readonly write?: { readonly kind: "member" | "method"; readonly name: string };
  readonly resultType?: MojoTargetTypeRef;
  readonly storageType?: MojoTargetTypeRef;
  readonly raises: boolean;
}
