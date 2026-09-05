import type { Node } from "@tsonic/tsts";
import type { MojoSourceCallableSpecializationVariant } from "../../../../analysis/callables/specializations.js";
import type { MojoAnalyzedFunction } from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type {
  MojoFunctionDeclaration,
  MojoParameter,
} from "../../../target-ast/index.js";
import {
  withMojoErrorType,
  withMojoGenericSubstitutions,
  withMojoLocalNameScope,
  withMojoSelfType,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import {
  planLocationParameterPrelude,
  planMojoFunctionBody,
} from "../../declarations/project.js";
import { planMojoGenericParameters } from "../../declarations/generic-parameters.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  specializeMojoFunctionDeclaration,
  substituteMojoDeclaration,
} from "../../types/substitution.js";

export function planMojoProjectImplementation(
  implementation: MojoAnalyzedFunction,
  name: string,
  context: MojoPlanningContext,
  specialization?: MojoSourceCallableSpecializationVariant,
): MojoFunctionDeclaration | undefined {
  const specializedContext: MojoPlanningContext = specialization === undefined
    ? context
    : Object.freeze({
        ...withMojoGenericSubstitutions(context, specialization.substitutions),
        syntheticDeclarations: [],
        callableArtifactNames: new WeakMap<Node, string>(),
      });
  registerMojoTypeImports(implementation.resultType, specializedContext);
  if (implementation.errorType !== undefined) {
    registerMojoTypeImports(implementation.errorType, specializedContext);
  }
  const implementationContext = withMojoSelfType(
    withMojoErrorType(withMojoLocalNameScope(specializedContext), implementation.errorType),
    implementation.owner?.type,
  );
  const body = planMojoFunctionBody(implementation, implementationContext);
  if (body === undefined) return undefined;
  const declaration: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name,
    genericParameters: planMojoGenericParameters(implementation),
    parameters: Object.freeze(implementation.parameters.map((parameter): MojoParameter => {
      registerMojoTypeImports(parameter.bodyType, specializedContext);
      return Object.freeze({
        name: parameter.name,
        type: parameter.bodyType,
        convention: parameter.disposition.kind === "immutable" && parameter.disposition.localCopy
          ? "var"
          : mojoParameterConvention(parameter.disposition),
      });
    })),
    resultType: implementation.resultType,
    asynchronous: implementation.asynchronous,
    raises: implementation.raises,
    ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
    self: "self",
    statements: Object.freeze([
      ...planLocationParameterPrelude(implementation, implementationContext),
      ...body,
    ]),
  });
  if (specialization === undefined) return declaration;
  const transformed = specializeMojoFunctionDeclaration(
    declaration,
    specialization.substitutions,
    name,
  );
  context.syntheticDeclarations.push(...specializedContext.syntheticDeclarations.map((synthetic) =>
    substituteMojoDeclaration(synthetic, specialization.substitutions)));
  return transformed;
}

export function planMojoProjectImplementationVariants(
  implementation: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const specializations = context.program.sourceCallableSpecializations;
  if (!specializations.requiresSpecialization(implementation.declaration)) {
    const name = context.program.projectDispatch.implementationName(implementation.declaration);
    const declaration = name === undefined
      ? undefined
      : planMojoProjectImplementation(implementation, name, context);
    return declaration === undefined ? undefined : Object.freeze([declaration]);
  }
  const declarations: MojoFunctionDeclaration[] = [];
  for (const specialization of specializations.variantsForCallable(implementation.declaration)) {
    const name = context.program.projectDispatch.implementationName(
      implementation.declaration,
      specialization.targetArguments,
    );
    if (name === undefined) return undefined;
    const declaration = planMojoProjectImplementation(
      implementation,
      name,
      context,
      specialization,
    );
    if (declaration === undefined) return undefined;
    declarations.push(declaration);
  }
  return declarations.length === 0 ? undefined : Object.freeze(declarations);
}
