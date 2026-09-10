import type { MojoCallableCapture, MojoCallableExpressionSelection } from "../../../analysis/program/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  mojoSelfExpression,
  withMojoBindingOverrides,
  withMojoSelfType,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";

export function mojoCallableCaptureValue(
  capture: MojoCallableCapture,
  selection: MojoCallableExpressionSelection,
  context: MojoPlanningContext,
): MojoExpression {
  if (capture.declaration === selection.expression) return mojoSelfExpression(context);
  const override = context.bindingOverrides.get(capture.declaration);
  if (override !== undefined && override.storage !== capture.storage) {
    throw new Error("A nested callable capture disagrees with its enclosing storage.");
  }
  return override?.expression ?? Object.freeze({ kind: "path", path: capture.name });
}

export function planMojoNativeCaptures(
  selection: MojoCallableExpressionSelection,
  context: MojoPlanningContext,
): {
  readonly context: MojoPlanningContext;
  readonly before: readonly MojoStatement[];
  readonly captures: readonly { readonly name: string; readonly convention: "imm" | "mut" }[];
} {
  const before: MojoStatement[] = [];
  const overrides = new Map(context.bindingOverrides);
  let bodyContext = context;
  const captures = selection.captures.map((capture) => {
    const value = mojoCallableCaptureValue(capture, selection, context);
    const name = value.kind === "path" && value.path === capture.name
      ? capture.name : allocateMojoSyntheticName(context, "capture");
    const expression: MojoExpression = Object.freeze({ kind: "path", path: name });
    if (name !== capture.name) before.push(Object.freeze({
      kind: "variable", name, reference: true, initializer: value,
    }));
    overrides.set(capture.declaration, Object.freeze({ expression, storage: capture.storage }));
    if (capture.declaration === selection.expression) {
      bodyContext = withMojoSelfType(bodyContext, capture.type, expression);
    }
    return Object.freeze({ name, convention: capture.storage === "location" ? "mut" as const : "imm" as const });
  });
  return Object.freeze({
    context: withMojoBindingOverrides(bodyContext, overrides),
    before: Object.freeze(before),
    captures: Object.freeze(captures),
  });
}
