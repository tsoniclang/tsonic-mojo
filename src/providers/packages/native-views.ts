import type { MojoProviderTypeRow } from "./model.js";
import type { MojoSourceValueFunction } from "../../target-model/conversions/source-value-function.js";
import { mojoSourceValueFunctionEquals } from "../../target-model/conversions/source-value-function.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";

export function createMojoProviderNativeViewIndex(rows: readonly MojoProviderTypeRow[]): (source: MojoTargetTypeRef, target: MojoTargetTypeRef) => MojoSourceValueFunction | undefined {
  const entries = new Map<string, { readonly source: MojoTargetTypeRef; readonly target: MojoTargetTypeRef; readonly factory: MojoSourceValueFunction }>();
  const key = (source: MojoTargetTypeRef, target: MojoTargetTypeRef): string => JSON.stringify([mojoTargetTypeKey(source), mojoTargetTypeKey(target)]);
  for (const row of rows) {
    for (const view of row.nativeViews ?? []) {
      const identity = key(row.targetType, view.targetType);
      const previous = entries.get(identity);
      if (previous !== undefined && (!mojoTargetTypeEquals(previous.source, row.targetType) || !mojoTargetTypeEquals(previous.target, view.targetType) || !mojoSourceValueFunctionEquals(previous.factory, view.factory))) {
        throw new Error(`Exact Mojo native view '${identity}' has conflicting provider factories.`);
      }
      entries.set(identity, Object.freeze({ source: row.targetType, target: view.targetType, factory: view.factory }));
    }
  }
  return (source, target) => {
    const entry = entries.get(key(source, target));
    return entry !== undefined && mojoTargetTypeEquals(source, entry.source) && mojoTargetTypeEquals(target, entry.target) ? entry.factory : undefined;
  };
}
