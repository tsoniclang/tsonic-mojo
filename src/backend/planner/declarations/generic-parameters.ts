import type {
  MojoAnalyzedCallableSignature,
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedTypeAlias,
} from "../../../analysis/program/model.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoGenericArgumentImports, registerMojoTypeImports } from "../types/imports.js";

export function planMojoGenericParameters(
  declaration: Pick<
    MojoAnalyzedFunction |
    MojoAnalyzedClass |
    MojoAnalyzedInterface |
    MojoAnalyzedTypeAlias |
    MojoAnalyzedCallableSignature,
    "typeParameters"
  >,
  context: MojoPlanningContext,
) {
  for (const parameter of declaration.typeParameters) {
    for (const constraint of parameter.constraints) registerMojoTypeImports(constraint, context);
    if (parameter.defaultArgument !== undefined) registerMojoGenericArgumentImports(parameter.defaultArgument, context);
  }
  return Object.freeze(declaration.typeParameters.map((parameter) => Object.freeze({
    kind: parameter.kind,
    name: parameter.name,
    identity: parameter.identity,
    position: parameter.position,
    variadic: parameter.variadic,
    constraints: parameter.constraints,
    ...(parameter.defaultArgument === undefined
      ? {}
      : { defaultArgument: parameter.defaultArgument }),
  })));
}
