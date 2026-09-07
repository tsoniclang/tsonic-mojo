import type { MojoTargetTypeRef } from "../types/model.js";
import type { MojoValueConversion } from "../conversions/model.js";

export type MojoBitwiseOperator = "~" | "&" | "|" | "^" | "<<" | ">>" | ">>>";
export type MojoNumericConversion = Extract<MojoValueConversion, { readonly kind: "identity" | "primitive-cast" }>;

export interface MojoNumericOperation {
  readonly operator: MojoBitwiseOperator;
  readonly implementation:
    | { readonly kind: "source-number"; readonly name: string }
    | { readonly kind: "native"; readonly unsignedType?: MojoTargetTypeRef };
  readonly operandType: MojoTargetTypeRef;
  readonly leftConversion: MojoNumericConversion;
  readonly rightConversion?: MojoNumericConversion;
  readonly resultType: MojoTargetTypeRef;
}
