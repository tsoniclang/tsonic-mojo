import type { ProviderDeclarationModel } from "@tsonic/tsts";
import type {
  MojoProviderOperationDefinition,
  MojoProviderTypeDefinition,
} from "../../packages/model.js";

export interface MojoCompilerProviderProjection {
  readonly declarationModel: ProviderDeclarationModel;
  readonly operations: readonly MojoProviderOperationDefinition[];
  readonly types: readonly MojoProviderTypeDefinition[];
}
