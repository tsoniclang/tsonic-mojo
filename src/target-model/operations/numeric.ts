import type { MojoTargetTypeRef } from "../types/model.js";
import type { MojoValueConversion } from "../conversions/model.js";

export type MojoNumericOperator = "~" | "&" | "|" | "^" | "<<" | ">>" | ">>>" | "%" | "/" | "**";
export type MojoNumericConversion = Extract<MojoValueConversion, { readonly kind: "identity" | "primitive-cast" }>;

export interface MojoNumericOperation {
  readonly operator: MojoNumericOperator;
  readonly implementation:
    | { readonly kind: "source-number"; readonly name: string }
    | { readonly kind: "native"; readonly unsignedType?: MojoTargetTypeRef };
  readonly operandType: MojoTargetTypeRef;
  readonly leftConversion: MojoNumericConversion;
  readonly rightConversion?: MojoNumericConversion;
  readonly resultType: MojoTargetTypeRef;
  readonly errorType?: MojoTargetTypeRef;
}
