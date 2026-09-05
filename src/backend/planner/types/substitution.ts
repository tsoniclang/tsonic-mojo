import type {
  MojoCallArgument,
  MojoCatchClause,
  MojoComptimeDeclaration,
  MojoDeclaration,
  MojoExpression,
  MojoFieldDeclaration,
  MojoFunctionDeclaration,
  MojoGenericParameterDeclaration,
  MojoLambdaCapture,
  MojoParameter,
  MojoStatement,
  MojoStructDeclaration,
  MojoTraitDeclaration,
  MojoTypeAliasDeclaration,
} from "../../target-ast/index.js";
import type { MojoTargetTypeSubstitutions } from "../../../target-model/types/substitution.js";
import {
  substituteMojoTargetGenericArguments,
  substituteMojoTargetType,
} from "../../../target-model/types/substitution.js";

export function specializeMojoFunctionDeclaration(
  declaration: MojoFunctionDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
  name: string,
): MojoFunctionDeclaration {
  return substituteFunction(declaration, substitutions, true, name);
}

export function substituteMojoDeclaration(
  declaration: MojoDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
): MojoDeclaration {
  switch (declaration.kind) {
    case "function": return substituteFunction(declaration, substitutions, false);
    case "struct": return substituteStruct(declaration, substitutions);
    case "trait": return substituteTrait(declaration, substitutions);
    case "type-alias": return substituteTypeAlias(declaration, substitutions);
    case "comptime": return substituteComptime(declaration, substitutions);
  }
}

function substituteFunction(
  declaration: MojoFunctionDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
  specializeOwnParameters: boolean,
  name = declaration.name,
): MojoFunctionDeclaration {
  const nested = specializeOwnParameters
    ? substitutions
    : withoutGenericParameters(substitutions, declaration.genericParameters);
  return Object.freeze({
    ...declaration,
    name,
    genericParameters: specializeOwnParameters
      ? Object.freeze([])
      : substituteGenericParameters(declaration.genericParameters, nested),
    parameters: Object.freeze(declaration.parameters.map((parameter) =>
      substituteParameter(parameter, nested))),
    resultType: substituteMojoTargetType(declaration.resultType, nested),
    ...(declaration.errorType === undefined
      ? {}
      : { errorType: substituteMojoTargetType(declaration.errorType, nested) }),
    ...(declaration.statements === undefined
      ? {}
      : { statements: Object.freeze(declaration.statements.map((statement) =>
          substituteStatement(statement, nested))) }),
  });
}

function substituteStruct(
  declaration: MojoStructDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
): MojoStructDeclaration {
  const nested = withoutGenericParameters(substitutions, declaration.genericParameters);
  return Object.freeze({
    ...declaration,
    genericParameters: substituteGenericParameters(declaration.genericParameters, nested),
    conformances: Object.freeze(declaration.conformances.map((type) =>
      substituteMojoTargetType(type, nested))),
    fields: Object.freeze(declaration.fields.map((field) => substituteField(field, nested))),
    methods: Object.freeze(declaration.methods.map((method) =>
      substituteFunction(method, nested, false))),
  });
}

function substituteTrait(
  declaration: MojoTraitDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTraitDeclaration {
  return Object.freeze({
    ...declaration,
    parents: Object.freeze(declaration.parents.map((type) =>
      substituteMojoTargetType(type, substitutions))),
    methods: Object.freeze(declaration.methods.map((method) =>
      substituteFunction(method, substitutions, false))),
  });
}

function substituteTypeAlias(
  declaration: MojoTypeAliasDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
): MojoTypeAliasDeclaration {
  const nested = withoutGenericParameters(substitutions, declaration.genericParameters);
  return Object.freeze({
    ...declaration,
    genericParameters: substituteGenericParameters(declaration.genericParameters, nested),
    value: substituteMojoTargetType(declaration.value, nested),
  });
}

function substituteComptime(
  declaration: MojoComptimeDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
): MojoComptimeDeclaration {
  const nested = withoutGenericParameters(substitutions, declaration.genericParameters);
  return Object.freeze({
    ...declaration,
    genericParameters: substituteGenericParameters(declaration.genericParameters, nested),
    ...(declaration.type === undefined
      ? {}
      : { type: substituteMojoTargetType(declaration.type, nested) }),
    initializer: substituteExpression(declaration.initializer, nested),
  });
}

function substituteGenericParameters(
  parameters: readonly MojoGenericParameterDeclaration[],
  substitutions: MojoTargetTypeSubstitutions,
): readonly MojoGenericParameterDeclaration[] {
  return Object.freeze(parameters.map((parameter) => Object.freeze({
    ...parameter,
    constraints: Object.freeze(parameter.constraints.map((constraint) =>
      substituteMojoTargetType(constraint, substitutions))),
    ...(parameter.defaultArgument === undefined
      ? {}
      : {
          defaultArgument: substituteMojoTargetGenericArguments(
            [parameter.defaultArgument],
            substitutions,
          )[0] ?? parameter.defaultArgument,
        }),
  })));
}

function substituteParameter(
  parameter: MojoParameter,
  substitutions: MojoTargetTypeSubstitutions,
): MojoParameter {
  return Object.freeze({
    ...parameter,
    type: substituteMojoTargetType(parameter.type, substitutions),
    ...(parameter.defaultValue === undefined
      ? {}
      : { defaultValue: substituteExpression(parameter.defaultValue, substitutions) }),
  });
}

function substituteField(
  field: MojoFieldDeclaration,
  substitutions: MojoTargetTypeSubstitutions,
): MojoFieldDeclaration {
  return Object.freeze({
    ...field,
    type: substituteMojoTargetType(field.type, substitutions),
    ...(field.initializer === undefined
      ? {}
      : { initializer: substituteExpression(field.initializer, substitutions) }),
  });
}

function substituteStatement(
  statement: MojoStatement,
  substitutions: MojoTargetTypeSubstitutions,
): MojoStatement {
  switch (statement.kind) {
    case "local-function":
      return Object.freeze({
        ...statement,
        declaration: substituteFunction(statement.declaration, substitutions, false),
      });
    case "return":
      return Object.freeze({
        ...statement,
        ...(statement.expression === undefined
          ? {}
          : { expression: substituteExpression(statement.expression, substitutions) }),
      });
    case "variable":
      return Object.freeze({
        ...statement,
        ...(statement.type === undefined
          ? {}
          : { type: substituteMojoTargetType(statement.type, substitutions) }),
        ...(statement.initializer === undefined
          ? {}
          : { initializer: substituteExpression(statement.initializer, substitutions) }),
      });
    case "tuple-variable":
      return Object.freeze({
        ...statement,
        initializer: substituteExpression(statement.initializer, substitutions),
      });
    case "assignment":
      return Object.freeze({
        ...statement,
        left: substituteExpression(statement.left, substitutions),
        right: substituteExpression(statement.right, substitutions),
      });
    case "expression":
    case "discard":
      return Object.freeze({
        ...statement,
        expression: substituteExpression(statement.expression, substitutions),
      });
    case "if":
      return Object.freeze({
        ...statement,
        condition: substituteExpression(statement.condition, substitutions),
        thenStatements: Object.freeze(statement.thenStatements.map((nested) =>
          substituteStatement(nested, substitutions))),
        ...(statement.elseStatements === undefined
          ? {}
          : { elseStatements: Object.freeze(statement.elseStatements.map((nested) =>
              substituteStatement(nested, substitutions))) }),
      });
    case "while":
      return Object.freeze({
        ...statement,
        condition: substituteExpression(statement.condition, substitutions),
        statements: Object.freeze(statement.statements.map((nested) =>
          substituteStatement(nested, substitutions))),
      });
    case "for":
      return Object.freeze({
        ...statement,
        iterable: substituteExpression(statement.iterable, substitutions),
        statements: Object.freeze(statement.statements.map((nested) =>
          substituteStatement(nested, substitutions))),
      });
    case "raise":
      return Object.freeze({
        ...statement,
        ...(statement.expression === undefined
          ? {}
          : { expression: substituteExpression(statement.expression, substitutions) }),
      });
    case "try":
      return Object.freeze({
        ...statement,
        statements: Object.freeze(statement.statements.map((nested) =>
          substituteStatement(nested, substitutions))),
        catches: Object.freeze(statement.catches.map((catch_) =>
          substituteCatch(catch_, substitutions))),
        ...(statement.finallyStatements === undefined
          ? {}
          : { finallyStatements: Object.freeze(statement.finallyStatements.map((nested) =>
              substituteStatement(nested, substitutions))) }),
      });
    case "with":
      return Object.freeze({
        ...statement,
        expression: substituteExpression(statement.expression, substitutions),
        statements: Object.freeze(statement.statements.map((nested) =>
          substituteStatement(nested, substitutions))),
      });
    case "break":
    case "continue":
    case "pass": return statement;
  }
}

function substituteCatch(
  catch_: MojoCatchClause,
  substitutions: MojoTargetTypeSubstitutions,
): MojoCatchClause {
  return Object.freeze({
    ...catch_,
    statements: Object.freeze(catch_.statements.map((statement) =>
      substituteStatement(statement, substitutions))),
  });
}

function substituteExpression(
  expression: MojoExpression,
  substitutions: MojoTargetTypeSubstitutions,
): MojoExpression {
  const nested = (value: MojoExpression): MojoExpression => substituteExpression(value, substitutions);
  switch (expression.kind) {
    case "type-value":
      return Object.freeze({ ...expression, type: substituteMojoTargetType(expression.type, substitutions) });
    case "tuple":
    case "list": return Object.freeze({ ...expression, elements: Object.freeze(expression.elements.map(nested)) });
    case "dictionary":
      return Object.freeze({
        ...expression,
        entries: Object.freeze(expression.entries.map((entry) => Object.freeze({
          key: nested(entry.key),
          value: nested(entry.value),
        }))),
      });
    case "unary": return Object.freeze({ ...expression, operand: nested(expression.operand) });
    case "binary": return Object.freeze({ ...expression, left: nested(expression.left), right: nested(expression.right) });
    case "conditional":
      return Object.freeze({
        ...expression,
        condition: nested(expression.condition),
        whenTrue: nested(expression.whenTrue),
        whenFalse: nested(expression.whenFalse),
      });
    case "call":
      return Object.freeze({
        ...expression,
        callee: nested(expression.callee),
        ...(expression.genericArguments === undefined
          ? {}
          : {
              genericArguments: substituteMojoTargetGenericArguments(
                expression.genericArguments,
                substitutions,
              ),
            }),
        arguments: substituteArguments(expression.arguments, substitutions),
      });
    case "method-call":
      return Object.freeze({
        ...expression,
        receiver: nested(expression.receiver),
        ...(expression.genericArguments === undefined
          ? {}
          : {
              genericArguments: substituteMojoTargetGenericArguments(
                expression.genericArguments,
                substitutions,
              ),
            }),
        arguments: substituteArguments(expression.arguments, substitutions),
      });
    case "member": return Object.freeze({ ...expression, receiver: nested(expression.receiver) });
    case "element":
      return Object.freeze({ ...expression, receiver: nested(expression.receiver), index: nested(expression.index) });
    case "proven-union-member":
      return Object.freeze({
        ...expression,
        receiver: nested(expression.receiver),
        type: substituteMojoTargetType(expression.type, substitutions),
      });
    case "slice":
      return Object.freeze({
        ...expression,
        receiver: nested(expression.receiver),
        ...(expression.start === undefined ? {} : { start: nested(expression.start) }),
        ...(expression.end === undefined ? {} : { end: nested(expression.end) }),
        ...(expression.step === undefined ? {} : { step: nested(expression.step) }),
      });
    case "construct":
      return Object.freeze({
        ...expression,
        type: substituteMojoTargetType(expression.type, substitutions),
        ...(expression.genericArguments === undefined
          ? {}
          : {
              genericArguments: substituteMojoTargetGenericArguments(
                expression.genericArguments,
                substitutions,
              ),
            }),
        arguments: substituteArguments(expression.arguments, substitutions),
      });
    case "generic-argument-value":
      return Object.freeze({
        ...expression,
        value: substituteMojoTargetGenericArguments([expression.value], substitutions)[0] ?? expression.value,
      });
    case "forced-comptime":
    case "copy":
    case "materialize":
    case "consume":
    case "postfix-deref":
    case "await":
    case "parenthesized": return Object.freeze({ ...expression, expression: nested(expression.expression) });
    case "lambda":
      return Object.freeze({
        ...expression,
        parameters: Object.freeze(expression.parameters.map((parameter) =>
          substituteParameter(parameter, substitutions))),
        captures: Object.freeze(expression.captures.map((capture): MojoLambdaCapture => Object.freeze({ ...capture }))),
        resultType: substituteMojoTargetType(expression.resultType, substitutions),
        expression: nested(expression.expression),
      });
    case "path":
    case "qualified-path":
    case "string-literal":
    case "number-literal":
    case "bool-literal":
    case "none-literal": return expression;
  }
}

function substituteArguments(
  arguments_: readonly MojoCallArgument[],
  substitutions: MojoTargetTypeSubstitutions,
): readonly MojoCallArgument[] {
  return Object.freeze(arguments_.map((argument) => Object.freeze({
    ...argument,
    value: substituteExpression(argument.value, substitutions),
  })));
}

function withoutGenericParameters(
  substitutions: MojoTargetTypeSubstitutions,
  parameters: readonly MojoGenericParameterDeclaration[],
): MojoTargetTypeSubstitutions {
  if (parameters.length === 0) return substitutions;
  const types = new Map(substitutions.types);
  const values = new Map(substitutions.values);
  const origins = new Map(substitutions.origins);
  const packs = new Map(substitutions.packs);
  for (const parameter of parameters) {
    if (parameter.kind === "type") types.delete(parameter.name);
    else if (parameter.kind === "origin") origins.delete(parameter.name);
    else values.delete(parameter.name);
    packs.delete(parameter.name);
    if (parameter.identity !== undefined) {
      types.delete(parameter.identity);
      values.delete(parameter.identity);
      origins.delete(parameter.identity);
      packs.delete(parameter.identity);
    }
  }
  return Object.freeze({ types, values, origins, packs });
}
