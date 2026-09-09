import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { collectionShape, jsValueBoxConversion } from "../../policy/conversions/javascript-conversions.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoJsValueField, MojoJsValueProjection, MojoJsValueGenericParameter } from "../../target-model/conversions/js-value-graph.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import type { MojoAnalyzedClass, MojoAnalyzedProjectCallable } from "../program/model.js";
import { selectMojoJsonMethod } from "./js-value-json-method.js";
import { sourceValueGenericParameters } from "./js-value-generics.js";

export interface MojoJsValueGraphContext {
  readonly source: TargetSourceProgram;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleResolver;
  readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly genericParameters: ReadonlyMap<string, MojoJsValueGenericParameter>;
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
  const visit = (type: MojoTargetTypeRef): string | undefined => {
    const id = mojoTargetTypeKey(type);
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
      return finish({ id, sourceType: type, kind: "object", identity: "structural", sourceCopy, fields: Object.freeze(fields) });
    }
    const owner = context.projectRelationships.definitionForType(type);
    const project = owner === undefined ? undefined : context.classByTypeId.get(owner.id);
    if (project !== undefined) {
      if (project.polymorphic) return reject("A polymorphic source view requires a closed concrete own-field dispatch inventory.");
      const fields: MojoJsValueField[] = [];
      for (const field of project.fields) {
        if (!field.ownProperty) continue;
        const fieldType = context.projectRelationships.instantiateMemberType(field.declaration, type, field.type);
        if (fieldType === undefined) return reject(`Project field '${field.sourceName}' has no exact instantiated carrier.`);
        const projection = visit(fieldType);
        if (projection === undefined) return undefined;
        fields.push(Object.freeze({ sourceName: field.sourceName, projection,
          access: Object.freeze({ kind: "project", declaration: field.declaration, name: field.name }) }));
      }
      const selected = selectMojoJsonMethod(type, context);
      if (selected.kind === "unsupported") return reject(selected.reason);
      const resultProjection = selected.kind === "resolved" ? visit(selected.resultType) : undefined;
      if (selected.kind === "resolved" && resultProjection === undefined) return undefined;
      return finish({ id, sourceType: type, kind: "object", sourceCopy, fields: Object.freeze(fields),
        identity: project.stateStorage === "direct" ? "project-direct" : "project-erased",
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
