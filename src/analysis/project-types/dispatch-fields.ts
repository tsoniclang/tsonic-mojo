import type { Node } from "@tsonic/tsts";
import { mojoParameterConvention } from "../representations/index.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoProjectDispatchField,
  MojoProjectDispatchFieldAdapter,
  MojoProjectDispatchIndex,
  MojoProjectDispatchIndexAdapter,
} from "../program/model.js";
import type {
  MojoProjectTypeDefinition,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type {
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";

import { instantiateMemberParameter } from "./dispatch-callables.js";
import {
  allocateName,
  functionType,
  projectObjectType,
  propertyDeclarations,
} from "./dispatch-support.js";

export function createDispatchField(
  receiverType: MojoTargetTypeRef,
  property: MojoProjectDispatchField["property"],
  usedNames: Set<string>,
  relationships: MojoProjectTypeRelationships,
): MojoProjectDispatchField | undefined {
  const sourceName = property.sourceName;
  if (property.kind === "accessor-property") {
    const readType = property.read === undefined
      ? undefined
      : relationships.instantiateMemberType(
          property.read.declaration,
          receiverType,
          property.read.resultType,
        );
    const declaredWriteParameter = property.write?.parameters[0];
    const writeParameter = property.write === undefined || declaredWriteParameter === undefined
      ? undefined
      : instantiateMemberParameter(
          property.write,
          receiverType,
          declaredWriteParameter,
          relationships,
        );
    const readErrorType = property.read?.errorType === undefined
      ? undefined
      : relationships.instantiateMemberType(
          property.read.declaration,
          receiverType,
          property.read.errorType,
        );
    const writeErrorType = property.write?.errorType === undefined
      ? undefined
      : relationships.instantiateMemberType(
          property.write.declaration,
          receiverType,
          property.write.errorType,
        );
    if ((property.read !== undefined && readType === undefined) ||
      (declaredWriteParameter !== undefined && writeParameter === undefined) ||
      (property.read?.errorType !== undefined && readErrorType === undefined) ||
      (property.write?.errorType !== undefined && writeErrorType === undefined)) return undefined;
    return Object.freeze({
      property,
      ...(readType === undefined ? {} : {
        read: Object.freeze({
          name: property.read!.name,
          slotName: allocateName(usedNames, `_${sourceName}_read_dispatch`),
          slotType: functionType(
            [{ type: projectObjectType, convention: "imm", passing: "plain" }],
            readType,
            property.read!.asynchronous,
            property.read!.raises,
            readErrorType,
          ),
          valueType: readType,
        }),
      }),
      ...(writeParameter === undefined ? {} : {
        write: Object.freeze({
          name: property.write!.name,
          slotName: allocateName(usedNames, `_${sourceName}_write_dispatch`),
          slotType: functionType([
            { type: projectObjectType, convention: "imm", passing: "plain" },
            {
              type: writeParameter.bodyType,
              convention: mojoParameterConvention(writeParameter.disposition),
              passing: writeParameter.disposition.kind === "owned" ? "consume" : "plain",
            },
          ], { kind: "unit" }, property.write!.asynchronous, property.write!.raises, writeErrorType),
          valueType: writeParameter.callType,
          disposition: writeParameter.disposition,
        }),
      }),
    });
  }
  const propertyType = relationships.instantiateMemberType(
    property.declaration,
    receiverType,
    property.type,
  );
  if (propertyType === undefined) return undefined;
  const readName = allocateName(usedNames, `get_${sourceName}`);
  const writeName = allocateName(usedNames, `set_${sourceName}`);
  return Object.freeze({
    property,
    read: Object.freeze({
      name: readName,
      slotName: allocateName(usedNames, `_${sourceName}_read_dispatch`),
      slotType: functionType(
        [{ type: projectObjectType, convention: "imm", passing: "plain" }],
        propertyType,
        false,
        false,
      ),
      valueType: propertyType,
    }),
    ...(property.kind === "interface-field" && property.readonly
      ? {}
      : {
          write: Object.freeze({
            name: writeName,
            slotName: allocateName(usedNames, `_${sourceName}_write_dispatch`),
            slotType: functionType([
              { type: projectObjectType, convention: "imm", passing: "plain" },
              { type: propertyType, convention: "imm", passing: "plain" },
            ], { kind: "unit" }, false, false),
            valueType: propertyType,
          }),
        }),
  });
}

export function createDispatchIndex(
  receiverType: MojoTargetTypeRef,
  indexSignature: import("../program/model.js").MojoAnalyzedInterfaceIndexSignature,
  usedNames: Set<string>,
  relationships: MojoProjectTypeRelationships,
): MojoProjectDispatchIndex | undefined {
  const keyType = relationships.instantiateMemberType(
    indexSignature.declaration,
    receiverType,
    indexSignature.keyType,
  );
  const valueType = relationships.instantiateMemberType(
    indexSignature.declaration,
    receiverType,
    indexSignature.valueType,
  );
  if (keyType === undefined || valueType === undefined) return undefined;
  const storageType = Object.freeze({
    kind: "dictionary" as const,
    key: keyType,
    value: valueType,
  });
  const read: MojoProjectDispatchIndex["read"] = Object.freeze({
    name: allocateName(usedNames, "get_index"),
    slotName: allocateName(usedNames, "_index_read_dispatch"),
    slotType: functionType([
      { type: projectObjectType, convention: "imm", passing: "plain" },
      { type: keyType, convention: "imm", passing: "plain" },
    ], valueType, false, false),
  });
  const write: MojoProjectDispatchIndex["write"] = indexSignature.readonly
    ? undefined
    : Object.freeze({
        name: allocateName(usedNames, "set_index"),
        slotName: allocateName(usedNames, "_index_write_dispatch"),
        slotType: functionType([
          { type: projectObjectType, convention: "imm", passing: "plain" },
          { type: keyType, convention: "imm", passing: "plain" },
          { type: valueType, convention: "imm", passing: "plain" },
        ], { kind: "unit" }, false, false),
      });
  return Object.freeze({
    indexSignature,
    keyType,
    valueType,
    read,
    ...(write === undefined ? {} : { write }),
    copy: Object.freeze({
      name: allocateName(usedNames, "copy_index_into"),
      slotName: allocateName(usedNames, "_index_copy_dispatch"),
      slotType: functionType([
        { type: projectObjectType, convention: "imm", passing: "plain" },
        { type: storageType, convention: "mut", passing: "plain" },
      ], { kind: "unit" }, false, false),
    }),
  });
}

export function createIndexAdapter(
  index: MojoProjectDispatchIndex,
  storageName: string,
  storageType: Extract<MojoTargetTypeRef, { readonly kind: "dictionary" }>,
  usedNames: Set<string>,
): MojoProjectDispatchIndexAdapter {
  const baseName = index.indexSignature.storageName;
  return Object.freeze({
    index,
    storageName,
    storageType,
    readAdapterName: allocateName(usedNames, `${baseName}_read_adapter`),
    ...(index.write === undefined
      ? {}
      : { writeAdapterName: allocateName(usedNames, `${baseName}_write_adapter`) }),
    copyAdapterName: allocateName(usedNames, `${baseName}_copy_adapter`),
  });
}

export function createFieldAdapter(
  field: MojoProjectDispatchField,
  concrete: MojoAnalyzedClass,
  viewDefinition: MojoProjectTypeDefinition,
  viewType: MojoTargetTypeRef,
  relationships: MojoProjectTypeRelationships,
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
  propertiesByDeclaration: WeakMap<Node, MojoProjectDispatchField["property"]>,
  names: Set<string>,
): MojoProjectDispatchFieldAdapter | undefined {
  const readType = field.read === undefined
    ? undefined
    : relationships.instantiateType(viewDefinition, viewType, field.read.valueType);
  const writeType = field.write === undefined
    ? undefined
    : relationships.instantiateType(viewDefinition, viewType, field.write.valueType);
  if (field.read !== undefined && readType === undefined ||
    field.write !== undefined && writeType === undefined) return undefined;
  const declaration = propertyDeclarations(field.property)[0];
  if (declaration === undefined) return undefined;
  const selected = relationships.memberImplementation(concrete.definition, declaration);
  if (selected.kind !== "resolved") return undefined;
  const selectedDeclaration = selected.implementation.declaration;
  const selectedProperty = propertiesByDeclaration.get(selectedDeclaration);
  const kind = selectedProperty?.kind;
  if (kind === "instance-field" || kind === "interface-field") {
    const storedProperty = selectedProperty as Extract<
      MojoProjectDispatchField["property"],
      { readonly kind: "instance-field" | "interface-field" }
    >;
    const owner = relationships.definitionContainingDeclaration(storedProperty.declaration);
    const lineage = relationships.classLineage(concrete.definition);
    const ownerIndex = owner === undefined || lineage === undefined
      ? -1
      : lineage.indexOf(owner);
    const ownerRelationship = owner === undefined
      ? undefined
      : relationships.relationship(concrete.targetType, owner);
    const storageType = ownerRelationship?.kind === "related"
      ? relationships.instantiateMemberType(
          storedProperty.declaration,
          ownerRelationship.targetType,
          storedProperty.type,
        )
      : undefined;
    const readConversion = storageType === undefined || readType === undefined
      ? undefined
      : classifyMojoValueConversion(storageType, readType, undefined, relationships);
    const writeConversion = storageType === undefined || writeType === undefined
      ? undefined
      : classifyMojoValueConversion(writeType, storageType, undefined, relationships);
    if (storedProperty.kind !== "instance-field" || ownerIndex < 0 || storageType === undefined ||
      readConversion?.kind === "unsupported" || writeConversion?.kind === "unsupported") return undefined;
    return Object.freeze({
      kind: "stored",
      field,
      ...(field.read === undefined ? {} : { readAdapterName: allocateName(names, `_read_${field.property.sourceName}`) }),
      ...(field.write === undefined ? {} : { writeAdapterName: allocateName(names, `_write_${field.property.sourceName}`) }),
      statePath: Object.freeze([
        ...Array.from({ length: lineage!.length - ownerIndex - 1 }, () => "_base"),
        storedProperty.name,
      ]),
      storageType,
      ...(readType === undefined ? {} : { readType }),
      ...(writeType === undefined ? {} : { writeType }),
      ...(readConversion?.kind === "resolved"
        ? { readResultConversion: readConversion.conversion }
        : {}),
      ...(writeConversion?.kind === "resolved"
        ? { writeValueConversion: writeConversion.conversion }
        : {}),
    });
  }
  const readDeclaration = field.property.kind === "accessor-property"
    ? field.property.read?.declaration
    : undefined;
  const writeDeclaration = field.property.kind === "accessor-property"
    ? field.property.write?.declaration
    : undefined;
  const readImplementation = readDeclaration === undefined
    ? undefined
    : implementationForContract(concrete, readDeclaration, relationships, implementations);
  const writeImplementation = writeDeclaration === undefined
    ? undefined
    : implementationForContract(concrete, writeDeclaration, relationships, implementations);
  const ownerDeclaration = readImplementation?.declaration ?? writeImplementation?.declaration;
  const owner = relationships.definitionContainingDeclaration(ownerDeclaration);
  const ownerRelation = owner === undefined ? undefined : relationships.relationship(concrete.targetType, owner);
  if (ownerRelation?.kind !== "related") return undefined;
  const readImplementationResult = readImplementation === undefined
    ? undefined
    : relationships.instantiateMemberType(
        readImplementation.declaration,
        ownerRelation.targetType,
        readImplementation.resultType,
      );
  const writeImplementationParameter = writeImplementation?.parameters[0] === undefined
    ? undefined
    : instantiateMemberParameter(
        writeImplementation,
        ownerRelation.targetType,
        writeImplementation.parameters[0],
        relationships,
      );
  const readConversion = readImplementationResult === undefined || readType === undefined
    ? undefined
    : classifyMojoValueConversion(
        readImplementationResult,
        readType,
        undefined,
        relationships,
      );
  const writeConversion = writeImplementationParameter === undefined || writeType === undefined
    ? undefined
    : classifyMojoValueConversion(
        writeType,
        writeImplementationParameter.callType,
        undefined,
        relationships,
      );
  if (field.read !== undefined && (readImplementation === undefined ||
      readConversion?.kind !== "resolved" ||
      readImplementation.asynchronous !== field.read.slotType.asynchronous ||
      readImplementation.raises && !field.read.slotType.raises) ||
    field.write !== undefined && (writeImplementation === undefined ||
      writeImplementationParameter === undefined || writeConversion?.kind !== "resolved" ||
      mojoParameterConvention(writeImplementationParameter.disposition) !==
        mojoParameterConvention(field.write.disposition ?? Object.freeze({
          kind: "immutable",
          localCopy: false,
        })) ||
      writeImplementation.asynchronous !== field.write.slotType.asynchronous ||
      writeImplementation.raises && !field.write.slotType.raises)) return undefined;
  return Object.freeze({
    kind: "accessor",
    field,
    ...(field.read === undefined ? {} : { readAdapterName: allocateName(names, `_read_${field.property.sourceName}`) }),
    ...(field.write === undefined ? {} : { writeAdapterName: allocateName(names, `_write_${field.property.sourceName}`) }),
    ...(readImplementation === undefined ? {} : { readImplementation }),
    ...(writeImplementation === undefined ? {} : { writeImplementation }),
    implementationOwnerType: ownerRelation.targetType,
    ...(readType === undefined ? {} : { readType }),
    ...(writeType === undefined ? {} : { writeType }),
    ...(readConversion?.kind === "resolved"
      ? { readResultConversion: readConversion.conversion }
      : {}),
    ...(writeConversion?.kind === "resolved"
      ? { writeValueConversion: writeConversion.conversion }
      : {}),
    ...(writeImplementationParameter === undefined ? {} : { writeImplementationParameter }),
  });
}

export function createPropertyIndex(
  classes: readonly MojoAnalyzedClass[],
  interfaces: readonly MojoAnalyzedInterface[],
): WeakMap<Node, MojoProjectDispatchField["property"]> {
  const index = new WeakMap<Node, MojoProjectDispatchField["property"]>();
  for (const class_ of classes) {
    for (const property of [...class_.fields, ...class_.accessorProperties]) {
      for (const declaration of propertyDeclarations(property)) index.set(declaration, property);
    }
  }
  for (const interface_ of interfaces) {
    for (const property of [...interface_.fields, ...interface_.accessorProperties]) {
      for (const declaration of propertyDeclarations(property)) index.set(declaration, property);
    }
  }
  return index;
}

export function implementationForContract(
  concrete: MojoAnalyzedClass,
  declaration: Node,
  relationships: MojoProjectTypeRelationships,
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
): MojoAnalyzedFunction | undefined {
  const selected = relationships.memberImplementation(concrete.definition, declaration);
  return selected.kind === "resolved"
    ? implementations.get(selected.implementation.declaration)
    : undefined;
}
