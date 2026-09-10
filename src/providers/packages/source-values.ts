import type { MojoSourceValueFactory } from "../../target-model/conversions/source-value-factory.js";
import { mojoSourceValueFactoryEquals } from "../../target-model/conversions/source-value-factory.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProviderTypeRow } from "./model.js";

export function createMojoProviderSourceValueIndex(rows: readonly MojoProviderTypeRow[]): {
  readonly factoryForType: (type: MojoTargetTypeRef) => MojoSourceValueFactory | undefined;
} {
  const factories = new Map<string, { readonly type: MojoTargetTypeRef; readonly factory: MojoSourceValueFactory }>();
  for (const row of rows) {
    if (row.sourceValueFactory === undefined) continue;
    const key = mojoTargetTypeKey(row.targetType);
    const previous = factories.get(key);
    if (previous !== undefined && (!mojoTargetTypeEquals(previous.type, row.targetType) ||
      !mojoSourceValueFactoryEquals(previous.factory, row.sourceValueFactory))) {
      throw new Error(`Exact Mojo provider carrier '${key}' has conflicting source-value factories.`);
    }
    factories.set(key, Object.freeze({ type: row.targetType, factory: row.sourceValueFactory }));
  }
  return Object.freeze({ factoryForType(type: MojoTargetTypeRef): MojoSourceValueFactory | undefined {
    const selected = factories.get(mojoTargetTypeKey(type));
    return selected !== undefined && mojoTargetTypeEquals(selected.type, type) ? selected.factory : undefined;
  } });
}
