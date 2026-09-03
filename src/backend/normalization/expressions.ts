import { mojoNumericLiteralCanInitialize } from "../../target-model/types/numeric-literals.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoParameter,
} from "../target-ast/index.js";

export function normalizeMojoExpression(expression: MojoExpression): MojoExpression {
  switch (expression.kind) {
    case "path":
    case "qualified-path":
    case "type-value":
    case "string-literal":
    case "number-literal":
    case "bool-literal":
    case "none-literal":
    case "generic-argument-value": return expression;
    case "tuple":
    case "list": return Object.freeze({
      ...expression,
      elements: Object.freeze(expression.elements.map(normalizeMojoExpression)),
    });
    case "dictionary": return Object.freeze({
      ...expression,
      entries: Object.freeze(expression.entries.map((entry) => Object.freeze({
        key: normalizeMojoExpression(entry.key),
        value: normalizeMojoExpression(entry.value),
      }))),
    });
    case "unary": return Object.freeze({
      ...expression,
      operand: normalizeMojoExpression(expression.operand),
    });
    case "binary": return Object.freeze({
      ...expression,
      left: normalizeMojoExpression(expression.left),
      right: normalizeMojoExpression(expression.right),
    });
    case "conditional": return Object.freeze({
      ...expression,
      condition: normalizeMojoExpression(expression.condition),
      whenTrue: normalizeMojoExpression(expression.whenTrue),
      whenFalse: normalizeMojoExpression(expression.whenFalse),
    });
    case "call": return Object.freeze({
      ...expression,
      callee: normalizeMojoExpression(expression.callee),
      arguments: normalizeArguments(expression.arguments),
    });
    case "method-call": return Object.freeze({
      ...expression,
      receiver: normalizeMojoExpression(expression.receiver),
      arguments: normalizeArguments(expression.arguments),
    });
    case "member": return Object.freeze({
      ...expression,
      receiver: normalizeMojoExpression(expression.receiver),
    });
    case "element": return Object.freeze({
      ...expression,
      receiver: normalizeMojoExpression(expression.receiver),
      index: normalizeMojoExpression(expression.index),
    });
    case "type-element": return Object.freeze({
      ...expression,
      receiver: normalizeMojoExpression(expression.receiver),
    });
    case "slice": return Object.freeze({
      ...expression,
      receiver: normalizeMojoExpression(expression.receiver),
      ...(expression.start === undefined
        ? {}
        : { start: normalizeMojoExpression(expression.start) }),
      ...(expression.end === undefined
        ? {}
        : { end: normalizeMojoExpression(expression.end) }),
      ...(expression.step === undefined
        ? {}
        : { step: normalizeMojoExpression(expression.step) }),
    });
    case "construct": return normalizeConstruction(expression);
    case "forced-comptime":
    case "copy":
    case "materialize":
    case "consume":
    case "postfix-deref":
    case "await": return Object.freeze({
      ...expression,
      expression: normalizeMojoExpression(expression.expression),
    });
    case "parenthesized": return normalizeMojoExpression(expression.expression);
    case "lambda": return Object.freeze({
      ...expression,
      parameters: Object.freeze(expression.parameters.map(normalizeParameter)),
      expression: normalizeMojoExpression(expression.expression),
    });
  }
}

function normalizeConstruction(
  expression: Extract<MojoExpression, { readonly kind: "construct" }>,
): MojoExpression {
  const arguments_ = normalizeArguments(expression.arguments);
  const onlyArgument = arguments_.length === 1 ? arguments_[0] : undefined;
  const inner = onlyArgument !== undefined && onlyArgument.name === undefined &&
      onlyArgument.spread !== true
    ? onlyArgument.value
    : undefined;
  const nestedArgument = inner?.kind === "construct" && inner.arguments.length === 1
    ? inner.arguments[0]
    : undefined;
  const literal = inner?.kind === "construct" && inner.type.kind === "source-primitive" &&
      inner.type.name === "float64" && nestedArgument !== undefined &&
      nestedArgument.name === undefined && nestedArgument.spread !== true &&
      nestedArgument.value.kind === "number-literal"
    ? nestedArgument.value
    : undefined;
  if (literal !== undefined && mojoNumericLiteralCanInitialize(literal.text, expression.type)) {
    return Object.freeze({
      ...expression,
      arguments: Object.freeze([Object.freeze({ value: literal })]),
    });
  }
  return Object.freeze({ ...expression, arguments: arguments_ });
}

function normalizeArguments(arguments_: readonly MojoCallArgument[]): readonly MojoCallArgument[] {
  return Object.freeze(arguments_.map((argument) => Object.freeze({
    ...argument,
    value: normalizeMojoExpression(argument.value),
  })));
}

export function normalizeMojoParameter(parameter: MojoParameter): MojoParameter {
  return normalizeParameter(parameter);
}

function normalizeParameter(parameter: MojoParameter): MojoParameter {
  return parameter.defaultValue === undefined
    ? parameter
    : Object.freeze({
        ...parameter,
        defaultValue: normalizeMojoExpression(parameter.defaultValue),
      });
}
