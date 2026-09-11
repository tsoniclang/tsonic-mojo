import type { TsonicMemoryLayoutFact } from "@tsonic/source-core/facts";
import type { MojoNativeLayout } from "../../target-model/operations/native-memory.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import { targetFieldInventory } from "../objects/provider-records.js";

export function selectMojoNativeLayout(layout: TsonicMemoryLayoutFact, type: MojoTargetTypeRef,
  source: TargetSourceProgram, providers: MojoProviderSemantics): MojoNativeLayout | undefined {
  let remaining = 1_024;
  return select(layout, type);

  function select(selected: TsonicMemoryLayoutFact, carrier: MojoTargetTypeRef): MojoNativeLayout | undefined {
    if (--remaining < 0) return undefined;
    const fields: MojoNativeLayout["fields"][number][] = [];
    let element: MojoNativeLayout | undefined;
    if (selected.kind === "array") {
      if (carrier.kind !== "fixed-array") return undefined;
      element = select(selected.elementLayout, carrier.element);
      if (element === undefined) return undefined;
    } else if (carrier.kind === "source-primitive") {
      if (carrier.name === "char" || selected.fields.length !== 0) return undefined;
    } else {
      if (carrier.kind !== "target-named" || selected.fields.length === 0) return undefined;
      const semantics = source.semantics.forNode(selected.call);
      const identity = selectedProviderDeclarationIdentity(source, semantics.facts.typeSubjects(selected.sourceType));
      if (identity?.exportId === undefined) return undefined;
      const rows = providers.types.filter((row) => row.exportId === identity.exportId && providerOwnerMatches(row, identity));
      if (rows.length !== 1) return undefined;
      const inventory = targetFieldInventory(rows[0]!, carrier, providers);
      if (inventory === undefined || inventory.size !== selected.fields.length) return undefined;
      const used = new Set<string>();
      for (const field of selected.fields) {
        const member = selectedProviderDeclarationIdentity(source, [field.selectedDeclaration, field.selectedSymbol]);
        if (member?.memberId === undefined || member.exportId !== identity.exportId || !providerOwnerMatches(rows[0]!, member)) return undefined;
        const storage = inventory.get(member.memberId);
        if (storage === undefined || used.has(storage.targetName)) return undefined;
        used.add(storage.targetName);
        const child = select(field.fieldLayout, storage.storageType);
        if (child === undefined) return undefined;
        fields.push(Object.freeze({ name: storage.targetName, byteOffset: field.byteOffset, layout: child }));
      }
    }
    return Object.freeze({ type: carrier, byteSize: selected.byteSize, byteAlignment: selected.byteAlignment,
      stride: selected.stride, addressWidth: selected.dataLayout.addressWidth, littleEndian: selected.dataLayout.byteOrder === "little",
      fields: Object.freeze(fields), ...(element === undefined ? {} : { element }) });
  }
}
