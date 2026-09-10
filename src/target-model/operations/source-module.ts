export interface MojoSourceModuleBootstrap {
  readonly id: string;
  readonly modulePath: readonly string[];
  readonly entryName: string;
  readonly completeName: string;
}

export interface MojoSourceModuleArgument {
  readonly parameterIndex: number;
  readonly bootstrap: MojoSourceModuleBootstrap;
}
