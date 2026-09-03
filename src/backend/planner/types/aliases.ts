import type {
  MojoDeclaration,
  MojoExpression,
  MojoStatement,
  MojoTypeAliasDeclaration,
} from "../../target-ast/index.js";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../../target-model/types/key.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "./imports.js";

export function planMojoPhysicalTypeAliases(
  declarations: readonly MojoDeclaration[],
  context: MojoPlanningContext,
): readonly MojoTypeAliasDeclaration[] {
  const selected = new Map<string, MojoTypeAliasDeclaration>();
  const visitType = (type: MojoTargetTypeRef): void => {
    const key = mojoTargetTypeKey(type);
    const alias = context.program.representations.aliasForType(type, context.module.modulePath);
    if (alias?.kind === "generated" && !selected.has(key)) {
      registerMojoTypeImports(type, context, key);
      selected.set(key, Object.freeze({
        kind: "type-alias",
        name: alias.name,
        genericParameters: Object.freeze([]),
        value: type,
        aliasedTypeKey: key,
      }));
    }
    for (const child of childTypes(type)) visitType(child);
  };
  for (const declaration of declarations) visitDeclaration(declaration, visitType);
  return Object.freeze([...selected.values()].sort((left, right) =>
    typeDepth(left.value) - typeDepth(right.value) || left.name.localeCompare(right.name, "en")));
}

function visitDeclaration(
  declaration: MojoDeclaration,
  visitType: (type: MojoTargetTypeRef) => void,
): void {
  switch (declaration.kind) {
    case "function":
      visitGenericParameters(declaration.genericParameters, visitType);
      for (const parameter of declaration.parameters) {
        visitType(parameter.type);
        if (parameter.defaultValue !== undefined) visitExpression(parameter.defaultValue, visitType);
      }
      visitType(declaration.resultType);
      if (declaration.errorType !== undefined) visitType(declaration.errorType);
      for (const statement of declaration.statements ?? []) visitStatement(statement, visitType);
      return;
    case "struct":
      visitGenericParameters(declaration.genericParameters, visitType);
      for (const conformance of declaration.conformances) visitType(conformance);
      for (const field of declaration.fields) {
        visitType(field.type);
        if (field.initializer !== undefined) visitExpression(field.initializer, visitType);
      }
      for (const method of declaration.methods) visitDeclaration(method, visitType);
      return;
    case "trait":
      for (const parent of declaration.parents) visitType(parent);
      for (const method of declaration.methods) visitDeclaration(method, visitType);
      return;
    case "type-alias":
      visitGenericParameters(declaration.genericParameters, visitType);
      visitType(declaration.value);
      return;
    case "comptime":
      visitGenericParameters(declaration.genericParameters, visitType);
      if (declaration.type !== undefined) visitType(declaration.type);
      visitExpression(declaration.initializer, visitType);
      return;
  }
}

function visitStatement(statement: MojoStatement, visitType: (type: MojoTargetTypeRef) => void): void {
  switch (statement.kind) {
    case "return": if (statement.expression !== undefined) visitExpression(statement.expression, visitType); return;
    case "variable":
      if (statement.type !== undefined) visitType(statement.type);
      if (statement.initializer !== undefined) visitExpression(statement.initializer, visitType);
      return;
    case "tuple-variable": visitExpression(statement.initializer, visitType); return;
    case "assignment":
      visitExpression(statement.left, visitType);
      visitExpression(statement.right, visitType);
      return;
    case "expression":
    case "discard": visitExpression(statement.expression, visitType); return;
    case "if":
      visitExpression(statement.condition, visitType);
      for (const nested of statement.thenStatements) visitStatement(nested, visitType);
      for (const nested of statement.elseStatements ?? []) visitStatement(nested, visitType);
      return;
    case "while":
      visitExpression(statement.condition, visitType);
      for (const nested of statement.statements) visitStatement(nested, visitType);
      return;
    case "for":
      visitExpression(statement.iterable, visitType);
      for (const nested of statement.statements) visitStatement(nested, visitType);
      return;
    case "raise": if (statement.expression !== undefined) visitExpression(statement.expression, visitType); return;
    case "try":
      for (const nested of statement.statements) visitStatement(nested, visitType);
      for (const catch_ of statement.catches) {
        for (const nested of catch_.statements) visitStatement(nested, visitType);
      }
      for (const nested of statement.finallyStatements ?? []) visitStatement(nested, visitType);
      return;
    case "with":
      visitExpression(statement.expression, visitType);
      for (const nested of statement.statements) visitStatement(nested, visitType);
      return;
    case "break":
    case "continue":
    case "pass": return;
  }
}

function visitExpression(expression: MojoExpression, visitType: (type: MojoTargetTypeRef) => void): void {
  switch (expression.kind) {
    case "tuple":
    case "list": for (const element of expression.elements) visitExpression(element, visitType); return;
    case "dictionary":
      for (const entry of expression.entries) {
        visitExpression(entry.key, visitType);
        visitExpression(entry.value, visitType);
      }
      return;
    case "unary": visitExpression(expression.operand, visitType); return;
    case "forced-comptime":
    case "copy":
    case "materialize":
    case "consume":
    case "postfix-deref":
    case "await":
    case "parenthesized": visitExpression(expression.expression, visitType); return;
    case "binary":
      visitExpression(expression.left, visitType);
      visitExpression(expression.right, visitType);
      return;
    case "conditional":
      visitExpression(expression.condition, visitType);
      visitExpression(expression.whenTrue, visitType);
      visitExpression(expression.whenFalse, visitType);
      return;
    case "call":
      visitExpression(expression.callee, visitType);
      visitGenericArguments(expression.genericArguments ?? [], visitType);
      for (const argument of expression.arguments) visitExpression(argument.value, visitType);
      return;
    case "method-call":
      visitExpression(expression.receiver, visitType);
      visitGenericArguments(expression.genericArguments ?? [], visitType);
      for (const argument of expression.arguments) visitExpression(argument.value, visitType);
      return;
    case "member": visitExpression(expression.receiver, visitType); return;
    case "element":
      visitExpression(expression.receiver, visitType);
      visitExpression(expression.index, visitType);
      return;
    case "type-element":
      visitExpression(expression.receiver, visitType);
      visitType(expression.type);
      return;
    case "slice":
      visitExpression(expression.receiver, visitType);
      if (expression.start !== undefined) visitExpression(expression.start, visitType);
      if (expression.end !== undefined) visitExpression(expression.end, visitType);
      if (expression.step !== undefined) visitExpression(expression.step, visitType);
      return;
    case "construct":
      visitType(expression.type);
      visitGenericArguments(expression.genericArguments ?? [], visitType);
      for (const argument of expression.arguments) visitExpression(argument.value, visitType);
      return;
    case "generic-argument-value": visitGenericArgument(expression.value, visitType); return;
    case "lambda":
      for (const parameter of expression.parameters) {
        visitType(parameter.type);
        if (parameter.defaultValue !== undefined) visitExpression(parameter.defaultValue, visitType);
      }
      visitType(expression.resultType);
      visitExpression(expression.expression, visitType);
      return;
    case "path":
    case "qualified-path":
    case "string-literal":
    case "number-literal":
    case "bool-literal":
    case "none-literal": return;
    case "type-value": visitType(expression.type); return;
  }
}

function visitGenericParameters(
  parameters: readonly MojoProviderTargetGenericParameter[],
  visitType: (type: MojoTargetTypeRef) => void,
): void {
  for (const parameter of parameters) {
    for (const constraint of parameter.constraints) visitType(constraint);
    if (parameter.defaultArgument !== undefined) visitGenericArgument(parameter.defaultArgument, visitType);
  }
}

function visitGenericArguments(
  arguments_: readonly MojoTargetGenericArgument[],
  visitType: (type: MojoTargetTypeRef) => void,
): void {
  for (const argument of arguments_) visitGenericArgument(argument, visitType);
}

function visitGenericArgument(
  argument: MojoTargetGenericArgument,
  visitType: (type: MojoTargetTypeRef) => void,
): void {
  if (argument.kind === "type") visitType(argument.type);
}

function childTypes(type: MojoTargetTypeRef): readonly MojoTargetTypeRef[] {
  switch (type.kind) {
    case "list":
    case "fixed-array": return [type.element];
    case "dictionary": return [type.key, type.value];
    case "future": return [type.output];
    case "optional": return [type.value];
    case "union": return type.members;
    case "tuple": return type.elements;
    case "associated": return [
      type.owner,
      ...type.genericArguments.flatMap((argument) => argument.kind === "type" ? [argument.type] : []),
    ];
    case "reference": return [type.value];
    case "callable": return [
      ...type.parameters.map((parameter) => parameter.type),
      type.result,
      ...(type.errorType === undefined ? [] : [type.errorType]),
    ];
    case "function": return [
      ...type.genericParameters.flatMap((parameter) => [
        ...parameter.constraints,
        ...(parameter.defaultArgument?.kind === "type" ? [parameter.defaultArgument.type] : []),
      ]),
      ...type.parameters.map((parameter) => parameter.type),
      type.result,
      ...(type.errorType === undefined ? [] : [type.errorType]),
    ];
    case "target-named": return (type.genericArguments ?? []).flatMap((argument) =>
      argument.kind === "type" ? [argument.type] : []);
    default: return [];
  }
}

function typeDepth(type: MojoTargetTypeRef): number {
  const children = childTypes(type);
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(typeDepth));
}
