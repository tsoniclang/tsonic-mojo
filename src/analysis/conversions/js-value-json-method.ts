import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoAnalyzedProjectCallable } from "../program/model.js";

export type MojoSelectedJsonMethod =
  | { readonly kind: "absent" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | {
      readonly kind: "resolved";
      readonly declaration: Node;
      readonly name: string;
      readonly passesPropertyKey: boolean;
      readonly resultType: MojoTargetTypeRef;
      readonly errorType?: MojoTargetTypeRef;
    };

export function selectMojoJsonMethod(
  sourceType: MojoTargetTypeRef,
  context: {
    readonly source: TargetSourceProgram;
    readonly projectRelationships: MojoProjectTypeRelationships;
    readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
  },
): MojoSelectedJsonMethod {
  const definition = context.projectRelationships.definitionForType(sourceType);
  if (definition === undefined) return Object.freeze({ kind: "absent" });
  const semantics = context.source.semantics.forFile(definition.sourceFile);
  const declaredType = semantics.declarations.declaredType(definition.declaration);
  if (declaredType === undefined) return unsupported("Project JSON selection has no exact declared source type.");
  const properties = semantics.types.propertyInfos(declaredType).filter((property) => property.name === "toJSON");
  if (properties.length === 0) return Object.freeze({ kind: "absent" });
  if (properties.length !== 1 || properties[0]!.optional) {
    return unsupported("Project JSON selection requires one required checker-selected toJSON property.");
  }
  const property = properties[0]!;
  const declarations = [...new Set([property.symbol, ...property.rootSymbols].flatMap((symbol) =>
    semantics.declarations.symbolDeclarations(symbol)))];
  const selectedDeclarations = new Set<Node>();
  for (const declaration of declarations) {
    const selected = context.projectRelationships.memberImplementation(definition, declaration);
    if (selected.kind !== "resolved") return unsupported("A toJSON property has no exact project member implementation.");
    selectedDeclarations.add(selected.implementation.declaration);
  }
  const callables = [...new Set([...selectedDeclarations].map((declaration) => context.callableByDeclaration.get(declaration))
    .filter((callable): callable is MojoAnalyzedProjectCallable => callable !== undefined))];
  if (callables.length !== 1) return unsupported("A toJSON property must select one exact analyzed method.");
  const contract = callables[0]!.contract;
  if (contract.kind !== "method" || contract.static === true || contract.asynchronous || contract.typeParameters.length !== 0) {
    return unsupported("A toJSON projection requires a synchronous non-generic instance method.");
  }
  const owner = context.projectRelationships.definitionContainingDeclaration(contract.declaration);
  const relationship = owner === undefined ? undefined : context.projectRelationships.relationship(sourceType, owner);
  if (owner === undefined || relationship?.kind !== "related") {
    return unsupported("A toJSON method has no exact instantiated receiver relationship.");
  }
  const instantiate = (type: MojoTargetTypeRef) => context.projectRelationships.instantiateMemberType(
    contract.declaration, relationship.targetType, type,
  );
  const parameters = contract.parameters.map((parameter) => instantiate(parameter.callType));
  const passesPropertyKey = parameters.length === 1 && parameters[0]?.kind === "native-string" &&
    contract.parameters[0]!.disposition.kind === "immutable";
  if (parameters.length !== 0 && !passesPropertyKey) {
    return unsupported("A toJSON method requires zero parameters or one immutable native string key.");
  }
  const resultType = instantiate(contract.resultType);
  const errorType = contract.errorType === undefined ? undefined : instantiate(contract.errorType);
  if (resultType === undefined || contract.errorType !== undefined && errorType === undefined) {
    return unsupported("The selected toJSON result or error carrier is not exactly instantiated.");
  }
  return Object.freeze({
    kind: "resolved", declaration: contract.declaration, name: contract.name,
    passesPropertyKey, resultType, ...(errorType === undefined ? {} : { errorType }),
  });
}

function unsupported(reason: string): MojoSelectedJsonMethod {
  return Object.freeze({ kind: "unsupported", reason });
}
