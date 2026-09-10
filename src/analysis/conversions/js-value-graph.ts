import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { collectionShape, jsValueBoxConversion } from "../../policy/conversions/javascript-conversions.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoJsValueField, MojoJsValueProjection, MojoJsValueGenericParameter, MojoJsValueAccessor } from "../../target-model/conversions/js-value-graph.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import type { MojoAnalyzedClass, MojoAnalyzedProjectCallable, MojoAnalyzedAccessorProperty } from "../program/model.js";
import { selectMojoJsonMethod } from "./js-value-json-method.js";
import { sourceValueGenericParameters } from "./js-value-generics.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoProjectFieldStoragePath } from "../../target-model/types/project-storage.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import { selectMojoSourceValueAccessors } from "./js-value-accessors.js";
import type { MojoSourceValueFunction } from "../../target-model/conversions/source-value-function.js";

export interface MojoJsValueGraphContext {
  readonly source: TargetSourceProgram;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleResolver;
  readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly genericParameters: ReadonlyMap<string, MojoJsValueGenericParameter>;
  readonly modules: MojoSourceModuleCatalog;
  readonly accessorByDeclaration: WeakMap<Node, MojoAnalyzedAccessorProperty>;
  readonly providerSourceValueFactory: (type: MojoTargetTypeRef) => MojoSourceValueFunction | undefined;
}

export type MojoJsValueGraphSelection =
  | { readonly kind: "resolved"; readonly conversion: MojoValueConversion }
  | { readonly kind: "unsupported"; readonly reason: string };

const targetType = Object.freeze({ kind: "dynamic" as const, domain: "js" as const });

type ProjectionDraft = {
  [Kind in MojoJsValueProjection["kind"]]: Omit<Extract<MojoJsValueProjection, { readonly kind: Kind }>, "genericParameters">;
}[MojoJsValueProjection["kind"]];

export function selectMojoJsValueConversion(
  sourceType: MojoTargetTypeRef,
  context: MojoJsValueGraphContext,
): MojoJsValueGraphSelection {
  const definitions = new Map<string, MojoJsValueProjection>();
  const visiting = new Set<string>();
  let failure: string | undefined;
  const reject = (reason: string): undefined => { failure ??= reason; return undefined; };
  const visit = (type: MojoTargetTypeRef, exactConcrete = false): string | undefined => {
    const id = `${exactConcrete ? "concrete:" : ""}${mojoTargetTypeKey(type)}`;
    if (definitions.has(id) || visiting.has(id)) return id;
    if (definitions.size + visiting.size >= 65536) return reject("The closed source-value graph exceeds its type budget.");
    visiting.add(id);
    const genericParameters = sourceValueGenericParameters(type, context.genericParameters);
    if (genericParameters === undefined) return reject(`Source carrier '${id}' has no exact closed generic adapter contract.`);
    const finish = (definition: ProjectionDraft): string => {
      definitions.set(id, Object.freeze({ ...definition, genericParameters }) as MojoJsValueProjection);
      visiting.delete(id);
      return id;
    };
    const conversion = type.kind === "dynamic" && type.domain === "js"
      ? Object.freeze({ kind: "identity" as const }) : jsValueBoxConversion(type, targetType);
    if (conversion !== undefined) return finish({ id, sourceType: type, kind: "scalar", conversion });
    if (type.kind === "optional") {
      const value = visit(type.value);
      return value === undefined ? undefined : finish({ id, sourceType: type, kind: "optional", value });
    }
    if (type.kind === "union") {
      if (type.members.length === 0) return reject("An empty source-value union has no runtime member.");
      const members = [];
      for (const sourceType of type.members) {
        const projection = visit(sourceType);
        if (projection === undefined) return undefined;
        members.push(Object.freeze({ sourceType, projection }));
      }
      return finish({ id, sourceType: type, kind: "union", members: Object.freeze(members) });
    }
    const sourceCopy = context.lifecycle.capabilities(type).copy;
    if (sourceCopy === "unavailable") return reject(`Source carrier '${id}' cannot be retained without consuming its owner.`);
    const factory = context.providerSourceValueFactory(type);
    if (factory !== undefined) return finish({ id, sourceType: type, kind: "provider", factory });
    const sequence = collectionShape(type);
    if (sequence?.kind === "js-array") {
      const element = visit(sequence.element);
      return element === undefined ? undefined : finish({ id, sourceType: type, kind: "array", element, sourceCopy });
    }
    const structural = context.structuralObjects.definitionForType(type);
    if (structural !== undefined) {
      const fields: MojoJsValueField[] = [];
      for (const [index, field] of structural.fields.entries()) {
        const projection = visit(field.type);
        if (projection === undefined) return undefined;
        fields.push(Object.freeze({ sourceName: field.sourceName, projection,
          access: Object.freeze({ kind: "structural", index }) }));
      }
      return finish({ id, sourceType: type, kind: "object", prototypeIdentity: "", identity: "structural", sourceCopy, fields: Object.freeze(fields), accessors: Object.freeze([]) });
    }
    const owner = context.projectRelationships.definitionForType(type);
    const project = owner === undefined ? undefined : context.classByTypeId.get(owner.id);
    if (project !== undefined) {
      if (project.polymorphic && !exactConcrete) {
        const sourceComponent = context.modules.forSourceFile(project.sourceFile)?.componentId;
        if (sourceComponent === undefined) return reject("A source-value view has no exact component owner.");
        const candidates = context.projectRelationships.concreteClassesFor(project.definition)
          .filter((candidate) => candidate !== project.definition)
          .sort((left, right) =>
            (context.projectRelationships.classLineage(right)?.length ?? 0) -
              (context.projectRelationships.classLineage(left)?.length ?? 0) || left.id.localeCompare(right.id, "en"));
        const alternatives = [];
        for (const candidate of candidates) {
          if (candidate.typeParameters.length !== 0 ||
            context.modules.forSourceFile(candidate.sourceFile)?.componentId !== sourceComponent) {
            return reject("A polymorphic source-value family has no closed concrete route in its component.");
          }
          const candidateType = context.projectRelationships.openType(candidate);
          const relationship = context.projectRelationships.relationship(candidateType, project.definition);
          if (relationship.kind !== "related" || !mojoTargetTypeEquals(relationship.targetType, type)) continue;
          const projection = visit(candidateType, true);
          if (projection === undefined) return undefined;
          alternatives.push(Object.freeze({ sourceType: candidateType, projection }));
        }
        const baseProjection = visit(type, true);
        return baseProjection === undefined ? undefined : finish({
          id, sourceType: type, kind: "polymorphic", alternatives: Object.freeze(alternatives), baseProjection,
        });
      }
      const lineage = context.projectRelationships.classLineage(project.definition);
      if (lineage === undefined) return reject("A concrete own-field view has no exact inheritance storage path.");
      const fields = new Map<string, MojoJsValueField>();
      for (const [ownerIndex, fieldOwner] of lineage.entries()) {
        const fieldClass = context.classByTypeId.get(fieldOwner.id);
        if (fieldClass === undefined) return reject("An inherited own-field owner has no analyzed class.");
        for (const field of fieldClass.fields) {
        if (!field.ownProperty) continue;
        const fieldType = context.projectRelationships.instantiateMemberType(field.declaration, type, field.type);
        if (fieldType === undefined) return reject(`Project field '${field.sourceName}' has no exact instantiated carrier.`);
        const projection = visit(fieldType);
        if (projection === undefined) return undefined;
        fields.set(field.sourceName, Object.freeze({ sourceName: field.sourceName, projection,
          access: Object.freeze({ kind: "project", declaration: field.declaration,
            path: mojoProjectFieldStoragePath(lineage.length - ownerIndex - 1, field.name) }) }));
        }
      }
      const selected = selectMojoJsonMethod(type, context);
      if (selected.kind === "unsupported") return reject(selected.reason);
      const resultProjection = selected.kind === "resolved" ? visit(selected.resultType) : undefined;
      if (selected.kind === "resolved" && resultProjection === undefined) return undefined;
      const selectedAccessors = selectMojoSourceValueAccessors(type, new Set(fields.keys()), context);
      if (selectedAccessors === undefined) return reject("A source-value property lookup has no exact accessor contract.");
      const accessors: MojoJsValueAccessor[] = [];
      for (const accessor of selectedAccessors) {
        const resultProjection = visit(accessor.resultType);
        if (resultProjection === undefined) return undefined;
        accessors.push(Object.freeze({ ...accessor, resultProjection }));
      }
      return finish({ id, sourceType: type, kind: "object", prototypeIdentity: project.definition.id, sourceCopy, fields: Object.freeze([...fields.values()]),
        accessors: Object.freeze(accessors),
        identity: project.polymorphic ? "project-polymorphic" : project.stateStorage === "direct" ? "project-direct" : "project-erased",
        ...(selected.kind !== "resolved" ? {} : { toJson: Object.freeze({
          declaration: selected.declaration, name: selected.name, passesPropertyKey: selected.passesPropertyKey,
          resultType: selected.resultType, resultProjection: resultProjection!,
        }) }),
      });
    }
    return reject(`Source carrier '${id}' has no exact retained JavaScript value representation.`);
  };
  const root = visit(sourceType);
  if (root === undefined || failure !== undefined) {
    return Object.freeze({ kind: "unsupported", reason: failure ?? "A selected source-value dependency did not close." });
  }
  const definition = definitions.get(root)!;
  return Object.freeze({ kind: "resolved", conversion: definition.kind === "scalar" ? definition.conversion : Object.freeze({
    kind: "js-value-graph", sourceType, targetType,
    graph: Object.freeze({ root, definitions: Object.freeze([...definitions.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))) }),
  }) });
}
