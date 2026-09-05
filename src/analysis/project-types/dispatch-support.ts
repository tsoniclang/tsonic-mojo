import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedCallableSignature,
  MojoAnalyzedClass,
  MojoAnalyzedParameter,
  MojoProjectDispatchField,
  MojoProjectDispatchView,
} from "../program/model.js";
import type {
  MojoProjectTypeDefinition,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type { MojoTargetTypeSubstitutions } from "../../target-model/types/substitution.js";
import type { MojoSourceCallableSpecializationPlan } from "../callables/specializations.js";

export const projectObjectType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "tsonic.mojo.runtime.ProjectObject",
  modulePath: Object.freeze(["tsonic_runtime"]),
  name: "ProjectObject",
});

export const optionalProjectObjectType: MojoTargetTypeRef = Object.freeze({
  kind: "optional",
  value: projectObjectType,
});

export function createImplementationNames(
  classes: readonly MojoAnalyzedClass[],
  views: readonly MojoProjectDispatchView[],
  relationships: MojoProjectTypeRelationships,
  specializations: MojoSourceCallableSpecializationPlan,
): {
  readonly implementations: WeakMap<Node, string>;
  readonly usedByClass: Map<MojoProjectTypeDefinition, Set<string>>;
} {
  const implementations = new WeakMap<Node, string>();
  const usedByClass = new Map<MojoProjectTypeDefinition, Set<string>>();
  for (const class_ of classes) {
    const used = new Set<string>([
      "__init__",
      "__eq__",
      ...(class_.errorRole === "typed" ? ["write_to"] : []),
      ...class_.fields.map((field) => field.name),
      ...class_.methods.filter((method) => method.static === true).map((method) => method.name),
      ...class_.accessors.filter((accessor) => accessor.static === true).map((accessor) => accessor.name),
    ]);
    for (const view of views) {
      if (relationships.relationship(class_.targetType, view.definition).kind !== "related") continue;
      for (const callable of view.callables) used.add(callable.name);
      for (const field of view.fields) {
        if (field.read !== undefined) used.add(field.read.name);
        if (field.write !== undefined) used.add(field.write.name);
      }
      for (const index of view.indexes) {
        used.add(index.read.name);
        if (index.write !== undefined) used.add(index.write.name);
        used.add(index.copy.name);
      }
      for (const downcast of view.downcasts) used.add(downcast.name);
      for (const conversion of view.conversions) used.add(conversion.name);
    }
    for (const implementation of [...class_.methods, ...class_.accessors]) {
      if (implementation.static === true) continue;
      if (specializations.requiresSpecialization(implementation.declaration)) {
        for (const variant of specializations.variantsForCallable(implementation.declaration)) {
          used.add(variant.targetName);
        }
        continue;
      }
      implementations.set(
        implementation.declaration,
        allocateName(used, `_implement_${implementation.name}`),
      );
    }
    usedByClass.set(class_.definition, used);
  }
  return Object.freeze({ implementations, usedByClass });
}

export function callableSubstitutions(
  contract: Pick<MojoAnalyzedCallableSignature, "typeParameters">,
  genericArguments: readonly MojoTargetGenericArgument[],
): MojoTargetTypeSubstitutions | undefined {
  if (contract.typeParameters.length !== genericArguments.length) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  for (const [index, parameter] of contract.typeParameters.entries()) {
    const argument = genericArguments[index];
    if (parameter.kind === "type" && argument?.kind === "type") {
      types.set(parameter.name, argument.type);
      types.set(parameter.identity, argument.type);
    } else if (parameter.kind === "origin" && argument?.kind === "origin") {
      origins.set(parameter.name, argument.origin);
      origins.set(parameter.identity, argument.origin);
    }
    else if (parameter.kind === "value" && argument !== undefined &&
      argument.kind !== "type" && argument.kind !== "type-expression" &&
      argument.kind !== "origin" && argument.kind !== "unbound") {
      values.set(parameter.name, argument);
      values.set(parameter.identity, argument);
    }
    else return undefined;
  }
  return Object.freeze({ types, values, origins, packs: new Map() });
}

export function substituteParameter(
  parameter: MojoAnalyzedParameter,
  substitutions: MojoTargetTypeSubstitutions,
): MojoAnalyzedParameter {
  return Object.freeze({
    ...parameter,
    type: substituteMojoTargetType(parameter.type, substitutions),
    bodyType: substituteMojoTargetType(parameter.bodyType, substitutions),
    callType: substituteMojoTargetType(parameter.callType, substitutions),
  });
}

export function functionType(
  parameters: Extract<MojoTargetTypeRef, { readonly kind: "function" }>["parameters"],
  result: MojoTargetTypeRef,
  asynchronous: boolean,
  raises: boolean,
  errorType?: MojoTargetTypeRef,
): Extract<MojoTargetTypeRef, { readonly kind: "function" }> {
  return Object.freeze({
    kind: "function",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(parameters),
    result,
    asynchronous,
    thin: true,
    raises,
    ...(errorType === undefined ? {} : { errorType }),
  });
}

export function genericArgumentsCloseOverView(
  arguments_: readonly MojoTargetGenericArgument[],
  definition: MojoProjectTypeDefinition,
): boolean {
  const allowed = new Set(definition.typeParameters.flatMap((parameter) => [parameter.name, parameter.identity]));
  const referenced = new Set<string>();
  for (const argument of arguments_) collectGenericArgumentParameters(argument, referenced);
  return [...referenced].every((name) => allowed.has(name));
}

export function collectGenericArgumentParameters(
  argument: MojoTargetGenericArgument,
  output: Set<string>,
): void {
  if (argument.kind === "type") collectTypeParameters(argument.type, output);
  else if (argument.kind === "value-reference" && argument.path.length === 1) output.add(argument.path[0]!);
  else if (argument.kind === "origin" && argument.origin.kind === "parameter") output.add(argument.origin.name);
}

export function collectTypeParameters(type: MojoTargetTypeRef, output: Set<string>): void {
  if (type.kind === "type-parameter") {
    output.add(type.identity ?? type.name);
    output.add(type.name);
    return;
  }
  switch (type.kind) {
    case "target-named":
      for (const argument of type.genericArguments ?? []) collectGenericArgumentParameters(argument, output);
      return;
    case "list":
    case "fixed-array": collectTypeParameters(type.element, output); return;
    case "dictionary": collectTypeParameters(type.key, output); collectTypeParameters(type.value, output); return;
    case "future": collectTypeParameters(type.output, output); return;
    case "optional":
    case "reference": collectTypeParameters(type.value, output); return;
    case "union": for (const member of type.members) collectTypeParameters(member, output); return;
    case "tuple": for (const element of type.elements) collectTypeParameters(element, output); return;
    case "associated":
      collectTypeParameters(type.owner, output);
      for (const argument of type.genericArguments) collectGenericArgumentParameters(argument, output);
      return;
    case "callable":
    case "function":
      for (const parameter of type.parameters) collectTypeParameters(parameter.type, output);
      collectTypeParameters(type.result, output);
      if (type.errorType !== undefined) collectTypeParameters(type.errorType, output);
      return;
    default: return;
  }
}

export function propertyDeclarations(property: MojoProjectDispatchField["property"]): readonly Node[] {
  return property.kind === "accessor-property" ? property.declarations : [property.declaration];
}

export function sameProperty(
  left: MojoProjectDispatchField["property"],
  right: MojoProjectDispatchField["property"],
): boolean {
  const rightDeclarations = propertyDeclarations(right);
  return propertyDeclarations(left).some((declaration) => rightDeclarations.includes(declaration));
}

export function allocateName(used: Set<string>, requested: string): string {
  let candidate = requested;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${requested}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
