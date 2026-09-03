export interface MojoSupportedToolchain {
  readonly kind: "pixi-mojo";
  readonly compilerVersion: "1.1.0.dev2026083005";
  readonly channels: readonly ["conda-forge", "https://conda.modular.com/max-nightly/"];
  readonly platforms: readonly ["linux-64"];
  readonly commandEnvironment: "posix";
}

export function supportedMojoToolchain(): MojoSupportedToolchain {
  const channels = Object.freeze([
    "conda-forge",
    "https://conda.modular.com/max-nightly/",
  ]) as MojoSupportedToolchain["channels"];
  const platforms = Object.freeze(["linux-64"]) as MojoSupportedToolchain["platforms"];
  return Object.freeze({
    kind: "pixi-mojo",
    compilerVersion: "1.1.0.dev2026083005",
    channels,
    platforms,
    commandEnvironment: "posix",
  });
}
