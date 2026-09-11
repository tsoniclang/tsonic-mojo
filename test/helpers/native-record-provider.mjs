import { createMojoProviderPackage, mojoLifecycleTraitTargetType, mojoNamedTargetType } from "../../dist/public/provider.js";

export function nativeRecordProvider({ writableName = "amount", fieldKind = "member", includeTag = true } = {}) {
  const moduleSpecifier = "test:native-record";
  const exportId = "native.record.Header";
  const type = mojoNamedTargetType(exportId, ["native_record_fixture"], "Header");
  const fields = [{ name: "tag", nativeName: "kind", primitive: "uint8" }, { name: "count", nativeName: "amount", primitive: "uint32" }];
  return createMojoProviderPackage({ id: "@test/mojo-native-record", displayName: "Native record proof", version: "1",
    modules: [{ moduleSpecifier, providerModuleId: moduleSpecifier,
      imports: [{ moduleSpecifier: "@tsonic/core/types.js", namedImports: [{ exportedName: "uint8" }, { exportedName: "uint32" }] }],
      exports: [{ id: exportId, name: "Header", kind: "interface", members: fields.map((field) => ({
        id: `${exportId}.${field.name}`, name: field.name, kind: "property", readonly: false,
        type: { kind: "provider-ref", moduleSpecifier: "@tsonic/core/types.js", exportName: field.primitive },
      })) }] }],
    types: [{ exportId, sourceGenericParameters: [], targetType: type,
      conformances: ["copyable", "movable", "deinitializable"].map((lifecycleRole) => ({ trait: mojoLifecycleTraitTargetType(lifecycleRole), lifecycleRole })) }],
    operations: fields.filter((field) => includeTag || field.name !== "tag").flatMap((field) => {
      const storage = { kind: "source-primitive", name: field.primitive };
      const receiver = "imm";
      return [
        { exportId, memberId: `${exportId}.${field.name}`, operationKind: "property", receiverType: type,
          resultType: storage, parameterTypes: [],
          target: { kind: "property-read", access: { kind: fieldKind, name: field.nativeName }, receiver } },
        { exportId, memberId: `${exportId}.${field.name}`, operationKind: "property-set", receiverType: type,
          resultType: { kind: "unit" }, parameterTypes: [storage],
          target: { kind: "property-write", access: { kind: "member", name: field.name === "count" ? writableName : field.nativeName },
            receiver: "mut", value: { convention: "var", position: "positional" } } },
      ];
    }),
  });
}

export const nativeRecordSource = `
import type { Header } from "test:native-record";
import { abi } from "test:abi";
import { memoryLayout, memoryField, fieldOffsetOf, reinterpretRawPointer, offsetRawPointer, loadPointer, storePointer, unsafeContext } from "@tsonic/core/lang.js";
import type { RawPointer, uint8, uint32 } from "@tsonic/core/types.js";
const byte = memoryLayout<uint8>(abi, 1, 1, 1);
const word = memoryLayout<uint32>(abi, 4, 4, 4);
const header = memoryLayout<Header>(abi, 8, 4, 8,
  memoryField((value: Header) => value.tag, 0, 1, byte),
  memoryField((value: Header) => value.count, 4, 4, word));
export function update(raw: RawPointer | undefined): uint32 {
  unsafeContext();
  const record = reinterpretRawPointer(raw, header);
  const field = reinterpretRawPointer(offsetRawPointer(raw, fieldOffsetOf(header, value => value.count), abi), word);
  if (record === undefined || field === undefined) throw new Error("missing view");
  storePointer(field, 19);
  return loadPointer(record).count;
}
export function main(): void {}
`;
