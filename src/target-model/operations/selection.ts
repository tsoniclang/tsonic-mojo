import type { MojoProviderOperationForm } from "./model.js";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../types/model.js";

export interface MojoSelectedProviderOperation {
  readonly target: MojoProviderOperationForm;
  readonly receiverType?: MojoTargetTypeRef;
  readonly parameterTypes: readonly MojoTargetTypeRef[];
  readonly resultType: MojoTargetTypeRef;
  readonly genericArguments: readonly MojoTargetGenericArgument[];
  readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
}
