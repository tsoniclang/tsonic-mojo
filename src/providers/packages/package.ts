import type { CompilerExtension } from "@tsonic/tsts";
import type {
  TargetRuntimeContributionContext,
} from "@tsonic/target-api/provider";
import type {
  TargetRuntimeContributions,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import {
  mojoPackageNameAttribute,
  mojoPackagePathReferenceKind,
} from "../../target-model/project/runtime-reference.js";
import { snapshotClosedMetadata } from "./closed-data.js";
import type {
  MojoProviderPackageDefinition,
  MojoProviderPackageImplementation,
  MojoProviderPolicyContribution,
} from "./model.js";
import { mojoProviderPolicyContributionKind } from "./model.js";
import {
  createMojoProviderPackageSourceExtension,
  mojoProviderBindingProviderId,
} from "./source-provider.js";
import { validateMojoProviderPackageDefinition } from "./validation.js";

export function createMojoProviderPackage(
  definition: MojoProviderPackageDefinition,
): MojoProviderPackageImplementation {
  let closedDefinition: MojoProviderPackageDefinition;
  try {
    closedDefinition = snapshotClosedMetadata(definition);
  } catch (error) {
    throw new Error(
      `Mojo provider package '${String(definition.id)}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateMojoProviderPackageDefinition(closedDefinition);
  const providerId = mojoProviderBindingProviderId(closedDefinition.id);
  return Object.freeze({
    kind: "target-capability",
    targetId: "mojo",
    id: closedDefinition.id,
    displayName: closedDefinition.displayName,
    ...(closedDefinition.requiredSurfaces === undefined
      ? {}
      : { requiredSurfaces: closedDefinition.requiredSurfaces }),
    moduleOwnership: Object.freeze([
      ...closedDefinition.modules.map((module) => module.moduleSpecifier),
      ...(closedDefinition.moduleAliases ?? []).map((alias) => alias.moduleSpecifier),
    ].map((specifierPrefix) => Object.freeze({ specifierPrefix, providerId }))),
    sourceCompilerContributions(): { readonly extensions: readonly CompilerExtension[] } {
      return Object.freeze({
        extensions: Object.freeze([
          createMojoProviderPackageSourceExtension(closedDefinition),
        ]),
      });
    },
    runtimeContributions(_context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return Object.freeze({
        references: Object.freeze(closedDefinition.runtimePackages.map(
          (runtime): TargetRuntimeReference => Object.freeze({
            kind: mojoPackagePathReferenceKind,
            include: runtime.packagePath,
            attributes: Object.freeze({
              [mojoPackageNameAttribute]: runtime.packageName,
            }),
          }),
        )),
      });
    },
    createTargetContributions(): readonly MojoProviderPolicyContribution[] {
      return Object.freeze([Object.freeze({
        kind: mojoProviderPolicyContributionKind,
        contractVersion: 1 as const,
        definition: closedDefinition,
      })]);
    },
  });
}
