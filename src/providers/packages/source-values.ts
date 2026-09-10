import type { MojoSourceValueFunction } from "../../target-model/conversions/source-value-function.js";
import { mojoSourceValueFunctionEquals } from "../../target-model/conversions/source-value-function.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProviderTypeRow } from "./model.js";

export function createMojoProviderSourceValueIndex(rows: readonly MojoProviderTypeRow[]): {
  readonly factoryForType: (type: MojoTargetTypeRef) => MojoSourceValueFunction | undefined;
  readonly extractionForType: (type: MojoTargetTypeRef) => MojoSourceValueFunction | undefined;
} {
  type Entry = { readonly type: MojoTargetTypeRef; readonly operation: MojoSourceValueFunction };
  const factories = new Map<string, Entry>();
  const extractions = new Map<string, Entry>();
  for (const row of rows) {
    const key = mojoTargetTypeKey(row.targetType);
    for (const [role, operation, entries] of [
      ["factories", row.sourceValueFactory, factories],
      ["extractions", row.sourceValueExtraction, extractions],
    ] as const) {
      if (operation === undefined) continue;
      const previous = entries.get(key);
      if (previous !== undefined && (!mojoTargetTypeEquals(previous.type, row.targetType) ||
        !mojoSourceValueFunctionEquals(previous.operation, operation))) {
        throw new Error(`Exact Mojo provider carrier '${key}' has conflicting source-value ${role}.`);
      }
      entries.set(key, Object.freeze({ type: row.targetType, operation }));
    }
  }
  const select = (entries: ReadonlyMap<string, Entry>, type: MojoTargetTypeRef): MojoSourceValueFunction | undefined => {
    const selected = entries.get(mojoTargetTypeKey(type));
    return selected !== undefined && mojoTargetTypeEquals(selected.type, type) ? selected.operation : undefined;
  };
  return Object.freeze({
    factoryForType: (type: MojoTargetTypeRef) => select(factories, type),
    extractionForType: (type: MojoTargetTypeRef) => select(extractions, type),
  });
}
