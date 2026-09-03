import type { MojoAnalyzedFunction } from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type {
  MojoFunctionDeclaration,
  MojoParameter,
} from "../../../target-ast/index.js";
import {
  withMojoErrorType,
  withMojoLocalNameScope,
  withMojoSelfType,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import {
  planLocationParameterPrelude,
  planMojoFunctionBody,
  planMojoGenericParameters,
} from "../../declarations/project.js";
import { registerMojoTypeImports } from "../../types/imports.js";

export function planMojoProjectImplementation(
  implementation: MojoAnalyzedFunction,
  name: string,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  registerMojoTypeImports(implementation.resultType, context);
  if (implementation.errorType !== undefined) {
    registerMojoTypeImports(implementation.errorType, context);
  }
  const implementationContext = withMojoSelfType(
    withMojoErrorType(withMojoLocalNameScope(context), implementation.errorType),
    implementation.owner?.type,
  );
  const body = planMojoFunctionBody(implementation, implementationContext);
  if (body === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name,
    genericParameters: planMojoGenericParameters(implementation),
    parameters: Object.freeze(implementation.parameters.map((parameter): MojoParameter => {
      registerMojoTypeImports(parameter.bodyType, context);
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
}
