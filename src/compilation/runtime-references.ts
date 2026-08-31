import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { TargetCompilationSessionContext } from "@tsonic/target-api";
import type { TargetRuntimeContributionContext } from "@tsonic/target-api/provider";
import type { TargetRuntimeReference } from "@tsonic/target-api/artifacts";
import {
  mojoPackageNameAttribute,
  mojoPackagePathReferenceKind,
} from "../target-model/project/runtime-reference.js";

const packageRequire = createRequire(import.meta.url);

export function mojoRuntimePackageReference(
  context: Pick<TargetCompilationSessionContext, "paths"> |
    Pick<TargetRuntimeContributionContext, "paths">,
  npmPackageName: string,
  mojoPackageName: string,
): TargetRuntimeReference {
  const packageRoot = resolveRuntimePackageRoot(context, npmPackageName);
  return Object.freeze({
    kind: mojoPackagePathReferenceKind,
    include: resolve(packageRoot, "mojo"),
    attributes: Object.freeze({
      [mojoPackageNameAttribute]: mojoPackageName,
    }),
  });
}

function resolveRuntimePackageRoot(
  context: { readonly paths: { readonly projectRoot: string } },
  packageName: string,
): string {
  const packageJson = `${packageName}/package.json`;
  const projectRequire = createRequire(resolve(context.paths.projectRoot, "package.json"));
  for (const resolver of [projectRequire, packageRequire]) {
    try {
      return dirname(resolver.resolve(packageJson));
    } catch {
      continue;
    }
  }
  throw new Error(
    `Required Mojo runtime package '${packageName}' is not installed or does not export package.json.`,
  );
}
