import type {
  SelectedTargetCapabilityContributions,
} from "@tsonic/target-api/provider";
import { snapshotClosedMetadata } from "./closed-data.js";
import type {
  MojoProviderExportRow,
  MojoProviderOperationRow,
  MojoProviderPackageDefinition,
  MojoProviderPolicyContribution,
  MojoProviderSemantics,
  MojoProviderTypeRow,
} from "./model.js";
import { mojoProviderPolicyContributionKind } from "./model.js";
import { mojoProviderBindingProviderId } from "./source-provider.js";
import { validateMojoProviderPackageDefinition } from "./validation.js";

export function mojoProviderPolicyContributionsOf(
  capabilities: readonly SelectedTargetCapabilityContributions[],
): readonly MojoProviderPolicyContribution[] {
  const contributions: MojoProviderPolicyContribution[] = [];
  for (const capability of capabilities) {
    for (const contribution of capability.contributions) {
      if (contribution.kind !== mojoProviderPolicyContributionKind) {
        throw new Error(
          `Mojo capability '${capability.capabilityId}' supplied unsupported target contribution kind '${contribution.kind}'.`,
        );
      }
      const candidate = contribution as MojoProviderPolicyContribution;
      if (candidate.contractVersion !== 1 || candidate.definition === undefined) {
        throw new Error(
          `Mojo capability '${capability.capabilityId}' contributed an invalid '${mojoProviderPolicyContributionKind}' contract.`,
        );
      }
      if (candidate.definition.id !== capability.capabilityId) {
        throw new Error(
          `Mojo capability '${capability.capabilityId}' contributed provider metadata owned by '${candidate.definition.id}'.`,
        );
      }
      validateMojoProviderPackageDefinition(candidate.definition);
      contributions.push(snapshotClosedMetadata(candidate));
    }
  }
  return Object.freeze(contributions);
}

export function collectMojoProviderSemantics(
  capabilities: readonly SelectedTargetCapabilityContributions[],
): MojoProviderSemantics {
  return collectMojoProviderSemanticsFromDefinitions(
    mojoProviderPolicyContributionsOf(capabilities).map((entry) => entry.definition),
  );
}

export function collectMojoProviderSemanticsFromDefinitions(
  definitions: readonly MojoProviderPackageDefinition[],
): MojoProviderSemantics {
  const exports: MojoProviderExportRow[] = [];
  const operations: MojoProviderOperationRow[] = [];
  const types: MojoProviderTypeRow[] = [];
  for (const definition of definitions) {
    validateMojoProviderPackageDefinition(definition);
    const providerId = mojoProviderBindingProviderId(definition.id);
    const moduleByExportId = new Map(definition.modules.flatMap((module) =>
      module.exports.map((exported) => [exported.id, { module, exported }] as const)));
    for (const module of definition.modules) {
      for (const exported of module.exports) {
        exports.push(snapshotClosedMetadata({
          exportId: exported.id,
          declarationKind: exported.kind,
          providerPackageId: definition.id,
          providerId,
          providerVersion: definition.version,
          providerModuleId: module.providerModuleId,
          moduleSpecifier: module.moduleSpecifier,
        }));
      }
    }
    for (const operation of definition.operations) {
      const owner = moduleByExportId.get(operation.exportId);
      if (owner === undefined) {
        throw new Error(
          `Mojo provider package '${definition.id}' operation '${operation.memberId ?? operation.exportId}' has no declaration owner.`,
        );
      }
      operations.push(snapshotClosedMetadata({
        ...operation,
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: owner.module.providerModuleId,
        moduleSpecifier: owner.module.moduleSpecifier,
      }));
    }
    for (const type of definition.types ?? []) {
      const owner = moduleByExportId.get(type.exportId);
      if (owner === undefined) {
        throw new Error(
          `Mojo provider package '${definition.id}' type relation '${type.exportId}' has no declaration owner.`,
        );
      }
      types.push(snapshotClosedMetadata({
        ...type,
        providerPackageId: definition.id,
        providerId,
        providerVersion: definition.version,
        providerModuleId: owner.module.providerModuleId,
        moduleSpecifier: owner.module.moduleSpecifier,
      }));
    }
  }
  return Object.freeze({
    exports: mergeExactRows(exports, providerExportRowIdentity, "export"),
    operations: mergeExactRows(operations, providerOperationRowIdentity, "operation"),
    types: mergeExactRows(types, providerTypeRowIdentity, "type"),
  });
}

export function mergeMojoProviderSemantics(
  ...inputs: readonly MojoProviderSemantics[]
): MojoProviderSemantics {
  return Object.freeze({
    exports: mergeExactRows(
      inputs.flatMap((input) => input.exports),
      providerExportRowIdentity,
      "export",
    ),
    operations: mergeExactRows(
      inputs.flatMap((input) => input.operations),
      providerOperationRowIdentity,
      "operation",
    ),
    types: mergeExactRows(
      inputs.flatMap((input) => input.types),
      providerTypeRowIdentity,
      "type",
    ),
  });
}

function mergeExactRows<T>(
  rows: readonly T[],
  identityOf: (row: T) => string,
  kind: string,
): readonly T[] {
  const byIdentity = new Map<string, T>();
  for (const row of rows) {
    const identity = identityOf(row);
    const closed = snapshotClosedMetadata(row);
    const existing = byIdentity.get(identity);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(closed)) {
      throw new Error(`Mojo provider ${kind} '${identity}' has conflicting definitions.`);
    }
    byIdentity.set(identity, closed);
  }
  return Object.freeze([...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, row]) => row));
}

function providerExportRowIdentity(
  row: Pick<MojoProviderExportRow, "providerId" | "providerVersion" | "providerModuleId" | "exportId">,
): string {
  return `${row.providerId}\0${row.providerVersion}\0${row.providerModuleId}\0${row.exportId}`;
}

function providerOperationRowIdentity(row: MojoProviderOperationRow): string {
  return `${providerExportRowIdentity(row)}\0${row.memberId ?? ""}\0${row.signatureId ?? ""}\0${row.operationKind}`;
}

function providerTypeRowIdentity(row: MojoProviderTypeRow): string {
  return `${providerExportRowIdentity(row)}\0${JSON.stringify(row.targetType)}`;
}
