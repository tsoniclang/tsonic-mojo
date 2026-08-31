import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  ResolvedSourceCallInfo,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type {
  MojoProviderOperationRow,
  MojoProviderSemantics,
} from "../../providers/packages/model.js";
import { providerOwnerMatches } from "../types/resolution.js";

export type MojoProviderCallSelection =
  | { readonly kind: "selected"; readonly operation: MojoProviderOperationRow }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly count: number };

export function selectMojoProviderCall(
  source: TargetSourceProgram,
  call: ResolvedSourceCallInfo,
  semantics: MojoProviderSemantics,
): MojoProviderCallSelection {
  const identity = selectedProviderIdentity(source, call);
  if (identity === undefined || identity.exportId === undefined) {
    return { kind: "missing", reason: "the selected call has no exact provider declaration identity" };
  }
  const candidates = semantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) &&
    row.exportId === identity.exportId &&
    row.memberId === identity.memberId &&
    row.operationKind === "call");
  if (identity.signatureId === undefined) {
    return { kind: "missing", reason: "the selected provider call has no exact signature identity" };
  }
  const selected = candidates.filter((row) => row.signatureId === identity.signatureId);
  if (selected.length === 0) {
    return { kind: "missing", reason: "no Mojo operation row matches the selected provider signature" };
  }
  return selected.length === 1
    ? { kind: "selected", operation: selected[0]! }
    : { kind: "ambiguous", count: selected.length };
}

function selectedProviderIdentity(
  source: TargetSourceProgram,
  call: ResolvedSourceCallInfo,
): ProviderDeclarationIdentity | undefined {
  const signatureDeclaration = source.semantics.forNode(call.call)
    .declarations.signatureDeclaration(call.selectedSignature);
  if (signatureDeclaration === undefined) return undefined;
  const exact = source.sourceFacts.getFact(
    signatureDeclaration,
    providerVirtualDeclarationFactKey,
  );
  if (exact === undefined) return undefined;
  let merged: ProviderDeclarationIdentity = exact;

  const corroborations: ExtensionFactSubject[] = [];
  appendSubject(corroborations, call.sourceCalleeAccess?.selectedDeclaration);
  appendSubject(corroborations, call.sourceCalleeAccess?.selectedSymbol);
  appendSubject(corroborations, call.sourceCallee.selectedDeclaration);
  appendSubject(corroborations, call.sourceCallee.selectedSymbol);
  for (const subject of corroborations) {
    const identity = source.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey);
    if (identity === undefined) continue;
    const next = mergeIdentity(merged, identityWithoutSignature(identity));
    if (next === undefined) return undefined;
    merged = next;
  }
  return merged;
}

function appendSubject(
  subjects: ExtensionFactSubject[],
  subject: ExtensionFactSubject | Node | undefined,
): void {
  if (subject !== undefined && !subjects.includes(subject)) subjects.push(subject);
}

function mergeIdentity(
  left: ProviderDeclarationIdentity,
  right: ProviderDeclarationIdentity,
): ProviderDeclarationIdentity | undefined {
  if (left.providerId !== right.providerId ||
    left.providerModuleId !== right.providerModuleId ||
    left.moduleSpecifier !== right.moduleSpecifier) {
    return undefined;
  }
  const providerVersion = mergeOptional(left.providerVersion, right.providerVersion);
  const exportName = mergeOptional(left.exportName, right.exportName);
  const exportId = mergeOptional(left.exportId, right.exportId);
  const memberName = mergeOptional(left.memberName, right.memberName);
  const memberId = mergeOptional(left.memberId, right.memberId);
  const memberStatic = mergeOptional(left.memberStatic, right.memberStatic);
  const signatureId = mergeOptional(left.signatureId, right.signatureId);
  if (providerVersion === conflict || exportName === conflict ||
    exportId === conflict || memberName === conflict ||
    memberId === conflict || memberStatic === conflict || signatureId === conflict) return undefined;
  return Object.freeze({
    providerId: left.providerId,
    providerModuleId: left.providerModuleId,
    moduleSpecifier: left.moduleSpecifier,
    ...(providerVersion === undefined ? {} : { providerVersion }),
    ...(left.artifactFileName === undefined ? {} : { artifactFileName: left.artifactFileName }),
    ...(exportName === undefined ? {} : { exportName }),
    ...(exportId === undefined ? {} : { exportId }),
    ...(memberName === undefined ? {} : { memberName }),
    ...(memberId === undefined ? {} : { memberId }),
    ...(memberStatic === undefined ? {} : { memberStatic }),
    ...(signatureId === undefined ? {} : { signatureId }),
  });
}

function identityWithoutSignature(
  identity: ProviderDeclarationIdentity,
): ProviderDeclarationIdentity {
  const { signatureId: _signatureId, ...declaration } = identity;
  return declaration;
}

const conflict = Symbol("identity-conflict");

function mergeOptional<T extends string | boolean>(
  left: T | undefined,
  right: T | undefined,
): T | undefined | typeof conflict {
  return left !== undefined && right !== undefined && left !== right
    ? conflict
    : left ?? right;
}
