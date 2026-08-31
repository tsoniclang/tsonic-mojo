import type {
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "../model/model.js";

export const mojoCompilerProviderSpecifierPrefix = "@tsonic/mojo/";

export function mojoCompilerModuleSpecifier(
  package_: Pick<MojoCompilerPackageSnapshot, "kind" | "alias">,
  modulePath: readonly string[],
): string {
  const scope = package_.kind === "standard-library"
    ? "std"
    : `packages/${encodeURIComponent(package_.alias)}`;
  const path = modulePath.length === 0
    ? "index"
    : modulePath.map(encodeURIComponent).join("/");
  return `${mojoCompilerProviderSpecifierPrefix}${scope}/${path}.js`;
}

export function resolveMojoCompilerModuleSpecifier(
  snapshot: MojoCompilerProjectSnapshot,
  specifier: string,
): {
  readonly package: MojoCompilerPackageSnapshot;
  readonly modulePath: readonly string[];
} | undefined {
  for (const package_ of snapshot.packages) {
    const prefix = package_.kind === "standard-library"
      ? `${mojoCompilerProviderSpecifierPrefix}std/`
      : `${mojoCompilerProviderSpecifierPrefix}packages/${encodeURIComponent(package_.alias)}/`;
    if (!specifier.startsWith(prefix) || !specifier.endsWith(".js")) continue;
    const encoded = specifier.slice(prefix.length, -3);
    const modulePath = encoded === "index"
      ? []
      : encoded.split("/").map(decodeURIComponent);
    if (package_.modules.some((module) => samePath(module.modulePath, modulePath))) {
      return Object.freeze({ package: package_, modulePath: Object.freeze(modulePath) });
    }
  }
  return undefined;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
