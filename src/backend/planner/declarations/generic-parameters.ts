import type {
  MojoAnalyzedCallableSignature,
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedTypeAlias,
} from "../../../analysis/program/model.js";

export function planMojoGenericParameters(
  declaration: Pick<
    MojoAnalyzedFunction |
    MojoAnalyzedClass |
    MojoAnalyzedInterface |
    MojoAnalyzedTypeAlias |
    MojoAnalyzedCallableSignature,
    "typeParameters"
  >,
) {
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
