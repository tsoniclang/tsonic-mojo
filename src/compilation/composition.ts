import {
  createJsSourceSemanticsExtension,
  jsSourceSemanticsModules,
} from "@tsonic/js-source-profile";
import type {
  TargetProviderDescriptor,
  TargetSurfaceImplementation,
} from "@tsonic/target-api";
import type { TargetRuntimeContributionContext } from "@tsonic/target-api/provider";
import type { TargetRuntimeContributions } from "@tsonic/target-api/artifacts";
import { mojoJsSurfaceSourceProfileContributions } from "../source/profiles/declarations.js";
import { mojoRuntimePackageReference } from "./runtime-references.js";

export const mojoTargetProvider: TargetProviderDescriptor = Object.freeze({
  id: "mojo-provider",
  displayName: "Mojo target provider",
  moduleOwnership: Object.freeze([
    Object.freeze({ specifierPrefix: "@tsonic/mojo/" }),
  ]),
});

export const mojoTargetSurfaces: readonly TargetSurfaceImplementation[] = Object.freeze([
  Object.freeze({
    id: "js",
    displayName: "JavaScript surface",
    sourceProfileContributions: mojoJsSurfaceSourceProfileContributions,
    sourceCompilerContributions() {
      return Object.freeze({
        semanticsModules: jsSourceSemanticsModules(),
        extensions: Object.freeze([createJsSourceSemanticsExtension()]),
      });
    },
    runtimeContributions(context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return Object.freeze({
        references: Object.freeze([
          mojoRuntimePackageReference(context, "@tsonic/mojo-js", "tsonic_js"),
        ]),
      });
    },
  }),
]);
