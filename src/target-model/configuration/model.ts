import type {
  MojoOutputType,
  MojoProjectConfiguration,
} from "../project/model.js";
import type { MojoSupportedToolchain } from "../toolchain/supported.js";

export interface MojoCompilerCommandConfiguration {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
}

export interface MojoCompilerPackageConfiguration {
  readonly kind: "standard-library" | "package";
  readonly id: string;
  readonly alias: string;
  readonly packageName: string;
  readonly version: string;
  readonly importRoot: string;
  readonly sourceRoot: string;
}

export interface MojoCompilerProviderConfiguration {
  readonly command: MojoCompilerCommandConfiguration;
  readonly languageServer: MojoCompilerCommandConfiguration;
  readonly packages: readonly MojoCompilerPackageConfiguration[];
}

export interface MojoTargetConfiguration {
  readonly packageName: string;
  readonly outputType: MojoOutputType;
  readonly project: MojoProjectConfiguration;
  readonly compilerProvider: MojoCompilerProviderConfiguration;
  readonly toolchain: MojoSupportedToolchain;
}
