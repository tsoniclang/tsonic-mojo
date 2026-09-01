import type {
  MojoCallArgument,
  MojoDeclaration,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoSourceModule,
  MojoStatement,
  MojoStructDeclaration,
  MojoTraitDeclaration,
} from "../target-ast/nodes.js";
import { mojoGenericParametersText, mojoTypeName } from "../planner/types/render.js";

export function printMojoModule(module: MojoSourceModule): string {
  const lines = module.imports.map(printImport);
  if (lines.length > 0 && module.declarations.length > 0) lines.push("");
  for (const [index, declaration] of module.declarations.entries()) {
    lines.push(...printDeclaration(declaration, module.modulePath));
    if (index + 1 < module.declarations.length) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function printImport(import_: MojoSourceModule["imports"][number]): string {
  const path = import_.modulePath.join(".");
  if (import_.kind === "module") {
    return `import ${path}${import_.alias === undefined ? "" : ` as ${import_.alias}`}`;
  }
  return `from ${path} import ${import_.symbols.map((symbol) =>
    `${symbol.name}${symbol.alias === undefined ? "" : ` as ${symbol.alias}`}`).join(", ")}`;
}

function printDeclaration(declaration: MojoDeclaration, modulePath: readonly string[]): string[] {
  switch (declaration.kind) {
    case "function": return printFunction(declaration, 0, modulePath);
    case "struct": return printStruct(declaration, modulePath);
    case "trait": return printTrait(declaration, modulePath);
    case "type-alias": return [
      `comptime ${declaration.name}${mojoGenericParametersText(declaration.genericParameters, modulePath)} = ${
        requiredTypeName(declaration.value, modulePath)
      }`,
    ];
    case "comptime": {
      const type = declaration.type === undefined ? "" : `: ${requiredTypeName(declaration.type, modulePath)}`;
      return [`comptime ${declaration.name}${mojoGenericParametersText(declaration.genericParameters, modulePath)}${type} = ${
        printExpression(declaration.initializer, modulePath)
      }`];
    }
    case "module-variable": {
      const type = declaration.type === undefined ? "" : `: ${requiredTypeName(declaration.type, modulePath)}`;
      return [`var ${declaration.name}${type} = ${printExpression(declaration.initializer, modulePath)}`];
    }
  }
}

function printFunction(
  function_: MojoFunctionDeclaration,
  depth: number,
  modulePath: readonly string[],
): string[] {
  const indent = "    ".repeat(depth);
  const decorators = (function_.decorators ?? []).map((decorator) => `${indent}@${decorator}`);
  const parameters = [
    ...(function_.self === undefined ? [] : [function_.self]),
    ...function_.parameters.map((parameter) => printParameter(parameter, modulePath)),
  ].join(", ");
  const result = mojoTypeName(function_.resultType, modulePath);
  const signature = `${indent}${function_.asynchronous ? "async " : ""}def ${function_.name}${
    mojoGenericParametersText(function_.genericParameters, modulePath)
  }(${parameters})${function_.raises ? " raises" : ""}${result === undefined ? "" : ` -> ${result}`}:`;
  const body = function_.statements === undefined
    ? [`${indent}    ...`]
    : printBody(function_.statements, depth + 1, modulePath);
  return [...decorators, signature, ...body];
}

function printStruct(declaration: MojoStructDeclaration, modulePath: readonly string[]): string[] {
  const decorators = (declaration.decorators ?? []).map((decorator) => `@${decorator}`);
  const conformances = declaration.conformances.length === 0
    ? ""
    : `(${declaration.conformances.map((type) => requiredTypeName(type, modulePath)).join(", ")})`;
  const lines = [...decorators, `struct ${declaration.name}${
    mojoGenericParametersText(declaration.genericParameters, modulePath)
  }${conformances}:`];
  for (const field of declaration.fields) {
    lines.push(`    ${field.compileTime ? "comptime" : "var"} ${field.name}: ${requiredTypeName(field.type, modulePath)}${
      field.initializer === undefined ? "" : ` = ${printExpression(field.initializer, modulePath)}`
    }`);
  }
  for (const [index, method] of declaration.methods.entries()) {
    if (declaration.fields.length > 0 || index > 0) lines.push("");
    lines.push(...printFunction(method, 1, modulePath));
  }
  if (declaration.fields.length === 0 && declaration.methods.length === 0) lines.push("    pass");
  return lines;
}

function printTrait(declaration: MojoTraitDeclaration, modulePath: readonly string[]): string[] {
  const parents = declaration.parents.length === 0
    ? ""
    : `(${declaration.parents.map((type) => requiredTypeName(type, modulePath)).join(", ")})`;
  const lines = [`trait ${declaration.name}${parents}:`];
  for (const [index, method] of declaration.methods.entries()) {
    if (index > 0) lines.push("");
    lines.push(...printFunction({ ...method, statements: undefined }, 1, modulePath));
  }
  if (declaration.methods.length === 0) lines.push("    pass");
  return lines;
}

function printParameter(parameter: MojoParameter, modulePath: readonly string[]): string {
  const convention = parameter.convention === undefined || parameter.convention === "imm"
    ? ""
    : `${parameter.convention} `;
  const variadic = parameter.variadic === true ? "*" : "";
  return `${convention}${variadic}${parameter.name}: ${requiredTypeName(parameter.type, modulePath)}${
    parameter.defaultValue === undefined ? "" : ` = ${printExpression(parameter.defaultValue, modulePath)}`
  }`;
}

function printStatement(
  statement: MojoStatement,
  depth: number,
  modulePath: readonly string[],
): string[] {
  const indent = "    ".repeat(depth);
  switch (statement.kind) {
    case "return": return [`${indent}return${statement.expression === undefined ? "" : ` ${printExpression(statement.expression, modulePath)}`}`];
    case "variable": {
      const type = statement.type === undefined ? "" : `: ${requiredTypeName(statement.type, modulePath)}`;
      const initializer = statement.initializer === undefined ? "" : ` = ${printExpression(statement.initializer, modulePath)}`;
      return [`${indent}var ${statement.name}${type}${initializer}`];
    }
    case "assignment": return [`${indent}${printExpression(statement.left, modulePath)} ${statement.operator} ${printExpression(statement.right, modulePath)}`];
    case "expression": return [`${indent}${printExpression(statement.expression, modulePath)}`];
    case "if": {
      const lines = [`${indent}if ${printExpression(statement.condition, modulePath)}:`, ...printBody(statement.thenStatements, depth + 1, modulePath)];
      if (statement.elseStatements !== undefined) lines.push(`${indent}else:`, ...printBody(statement.elseStatements, depth + 1, modulePath));
      return lines;
    }
    case "while": return [`${indent}while ${printExpression(statement.condition, modulePath)}:`, ...printBody(statement.statements, depth + 1, modulePath)];
    case "for": return [`${indent}for ${statement.binding} in ${printExpression(statement.iterable, modulePath)}:`, ...printBody(statement.statements, depth + 1, modulePath)];
    case "break": return [`${indent}break`];
    case "continue": return [`${indent}continue`];
    case "pass": return [`${indent}pass`];
    case "raise": return [`${indent}raise${statement.expression === undefined ? "" : ` ${printExpression(statement.expression, modulePath)}`}`];
    case "try": {
      const lines = [`${indent}try:`, ...printBody(statement.statements, depth + 1, modulePath)];
      for (const catch_ of statement.catches) {
        lines.push(`${indent}except${catch_.name === undefined ? "" : ` ${catch_.name}`}:`, ...printBody(catch_.statements, depth + 1, modulePath));
      }
      if (statement.finallyStatements !== undefined) lines.push(`${indent}finally:`, ...printBody(statement.finallyStatements, depth + 1, modulePath));
      return lines;
    }
    case "with": return [
      `${indent}with ${printExpression(statement.expression, modulePath)}${statement.binding === undefined ? "" : ` as ${statement.binding}`}:`,
      ...printBody(statement.statements, depth + 1, modulePath),
    ];
  }
}

function printBody(
  statements: readonly MojoStatement[],
  depth: number,
  modulePath: readonly string[],
): string[] {
  return statements.length === 0
    ? [`${"    ".repeat(depth)}pass`]
    : statements.flatMap((statement) => printStatement(statement, depth, modulePath));
}

function printExpression(expression: MojoExpression, modulePath: readonly string[]): string {
  switch (expression.kind) {
    case "path": return expression.path;
    case "string-literal": return quoteMojoString(expression.value);
    case "number-literal": return expression.text;
    case "bool-literal": return expression.value ? "True" : "False";
    case "none-literal": return "None";
    case "tuple": return `(${expression.elements.map((element) => printExpression(element, modulePath)).join(", ")}${expression.elements.length === 1 ? "," : ""})`;
    case "list": return `[${expression.elements.map((element) => printExpression(element, modulePath)).join(", ")}]`;
    case "dictionary": return `{${expression.entries.map((entry) => `${printExpression(entry.key, modulePath)}: ${printExpression(entry.value, modulePath)}`).join(", ")}}`;
    case "unary": return `${expression.operator}${/^[A-Za-z]/u.test(expression.operator) ? " " : ""}${printExpression(expression.operand, modulePath)}`;
    case "binary": return `(${printExpression(expression.left, modulePath)} ${expression.operator} ${printExpression(expression.right, modulePath)})`;
    case "conditional": return `(${printExpression(expression.whenTrue, modulePath)} if ${printExpression(expression.condition, modulePath)} else ${printExpression(expression.whenFalse, modulePath)})`;
    case "call": return `${printExpression(expression.callee, modulePath)}${printCallGenericArguments(expression.genericArguments, modulePath)}(${expression.arguments.map((argument) => printCallArgument(argument, modulePath)).join(", ")})`;
    case "method-call": return `${printExpression(expression.receiver, modulePath)}.${expression.name}${printCallGenericArguments(expression.genericArguments, modulePath)}(${expression.arguments.map((argument) => printCallArgument(argument, modulePath)).join(", ")})`;
    case "member": return `${printExpression(expression.receiver, modulePath)}.${expression.name}`;
    case "element": return `${printExpression(expression.receiver, modulePath)}[${printExpression(expression.index, modulePath)}]`;
    case "slice": return `${printExpression(expression.receiver, modulePath)}[${expression.start === undefined ? "" : printExpression(expression.start, modulePath)}:${expression.end === undefined ? "" : printExpression(expression.end, modulePath)}${expression.step === undefined ? "" : `:${printExpression(expression.step, modulePath)}`}]`;
    case "construct": return `${requiredTypeName(expression.type, modulePath)}${printCallGenericArguments(expression.genericArguments, modulePath)}(${expression.arguments.map((argument) => printCallArgument(argument, modulePath)).join(", ")})`;
    case "consume": return `${printExpression(expression.expression, modulePath)}^`;
    case "postfix-deref": return `${printExpression(expression.expression, modulePath)}[]`;
    case "await": return `await ${printExpression(expression.expression, modulePath)}`;
    case "parenthesized": return `(${printExpression(expression.expression, modulePath)})`;
    case "lambda": return `lambda (${expression.parameters.map((parameter) => printParameter(parameter, modulePath)).join(", ")}): ${printExpression(expression.expression, modulePath)}`;
  }
}

function printCallGenericArguments(
  arguments_: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[] | undefined,
  modulePath: readonly string[],
): string {
  return arguments_ === undefined || arguments_.length === 0
    ? ""
    : `[${arguments_.map((argument) => renderCallGenericArgument(argument, modulePath)).join(", ")}]`;
}

function renderCallGenericArgument(
  argument: import("../../target-model/provider/model.js").MojoTargetGenericArgument,
  modulePath: readonly string[],
): string {
  const value = argument.kind === "type"
    ? requiredTypeName(argument.type, modulePath)
    : argument.kind === "unbound"
      ? "_"
      : argument.expression;
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

function printCallArgument(argument: MojoCallArgument, modulePath: readonly string[]): string {
  const value = `${argument.spread === true ? "*" : ""}${printExpression(argument.value, modulePath)}`;
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

function requiredTypeName(
  type: Parameters<typeof mojoTypeName>[0],
  modulePath: readonly string[],
): string {
  const name = mojoTypeName(type, modulePath);
  if (name === undefined) throw new Error("A value position cannot use the Mojo unit type.");
  return name;
}

function quoteMojoString(value: string): string {
  return JSON.stringify(value).replace(/\\u2028/gu, "\\u{2028}").replace(/\\u2029/gu, "\\u{2029}");
}
