import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoJsValueAccessor } from "../../target-model/conversions/js-value-graph.js";
import type { MojoJsValueGraphContext } from "./js-value-graph.js";
import type { MojoAnalyzedAccessorProperty } from "../program/model.js";

export function selectMojoSourceValueAccessors(
  sourceType: MojoTargetTypeRef,
  ownFields: ReadonlySet<string>,
  context: MojoJsValueGraphContext,
): readonly Omit<MojoJsValueAccessor, "resultProjection">[] | undefined {
  const definition = context.projectRelationships.definitionForType(sourceType);
  if (definition === undefined) return undefined;
  const semantics = context.source.semantics.forFile(definition.sourceFile);
  const declaredType = semantics.declarations.declaredType(definition.declaration);
  if (declaredType === undefined) return undefined;
  const selected: Omit<MojoJsValueAccessor, "resultProjection">[] = [];
  for (const property of semantics.types.propertyInfos(declaredType)) {
    if (ownFields.has(property.name)) continue;
    const declarations = new Set([property.symbol, ...property.rootSymbols].flatMap((symbol) =>
      semantics.declarations.symbolDeclarations(symbol)));
    const getters = new Set([...declarations].flatMap((declaration) => {
      const descriptor = context.accessorByDeclaration.get(declaration);
      return descriptor?.runtimeProperty === true && descriptor.read?.declaration === declaration ? [descriptor.read] : [];
    }));
    if (getters.size === 0) continue;
    const implementations = new Set<MojoAnalyzedAccessorProperty["read"]>();
    for (const getter of getters) {
      const implementation = context.projectRelationships.memberImplementation(definition, getter.declaration);
      if (implementation.kind !== "resolved") return undefined;
      const descriptor = context.accessorByDeclaration.get(implementation.implementation.declaration);
      if (descriptor === undefined || descriptor.runtimeProperty !== true) return undefined;
      implementations.add(descriptor.read);
    }
    if (implementations.size !== 1) return undefined;
    const getter = [...implementations][0];
    if (getter === undefined) continue;
    if (getter.static === true || getter.asynchronous || getter.parameters.length !== 0 || getter.typeParameters.length !== 0) return undefined;
    const resultType = context.projectRelationships.instantiateMemberType(getter.declaration, sourceType, getter.resultType);
    if (resultType === undefined) return undefined;
    selected.push(Object.freeze({ sourceName: property.name, declaration: getter.declaration, name: getter.name, resultType }));
  }
  return Object.freeze(selected);
}
