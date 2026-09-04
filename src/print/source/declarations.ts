import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoStructDeclaration,
  MojoTraitDeclaration,
} from "../../backend/target-ast/index.js";
import {
  block,
  concat,
  delimitedList,
  emptyDocument,
  group,
  hardLine,
  join,
  text,
} from "../document/builders.js";
import type { MojoDocument } from "../document/model.js";
import type { MojoPrintContext } from "./context.js";
import {
  printLambdaCaptures,
  printMojoExpressionDocument,
  printParameterDocument,
} from "./expressions.js";
import { printMojoBodyDocument } from "./statements.js";
import {
  printMojoGenericParametersDocument,
  printMojoTypeDocument,
  requiredMojoTypeDocument,
} from "./types.js";

export function printMojoDeclarationDocument(
  declaration: MojoDeclaration,
  context: MojoPrintContext,
): MojoDocument {
  switch (declaration.kind) {
    case "function": return printMojoFunctionDocument(declaration, context);
    case "struct": return printStructDocument(declaration, context);
    case "trait": return printTraitDocument(declaration, context);
    case "type-alias": return group(concat(
      text(`comptime ${declaration.name}`),
      printMojoGenericParametersDocument(declaration.genericParameters, context),
      text(" = "),
      declaration.value.kind === "unit"
        ? text("NoneType")
        : requiredMojoTypeDocument(declaration.value, declaration.aliasedTypeKey === undefined
          ? context
          : Object.freeze({ ...context, expandedAliasKey: declaration.aliasedTypeKey })),
    ));
    case "comptime": return group(concat(
      text(`comptime ${declaration.name}`),
      printMojoGenericParametersDocument(declaration.genericParameters, context),
      declaration.type === undefined
        ? emptyDocument
        : concat(text(": "), requiredMojoTypeDocument(declaration.type, context)),
      text(" = "),
      printMojoExpressionDocument(declaration.initializer, context),
    ));
  }
}

export function printMojoFunctionDocument(
  function_: MojoFunctionDeclaration,
  context: MojoPrintContext,
): MojoDocument {
  const ownTypeParameterIdentities = new Set(function_.genericParameters.flatMap((parameter) =>
    parameter.identity === undefined ? [] : [parameter.identity]));
  const functionContext = context.structTypeParameterIdentities === undefined ||
      ownTypeParameterIdentities.size === 0
    ? context
    : Object.freeze({
        ...context,
        structTypeParameterIdentities: new Set(
          [...context.structTypeParameterIdentities].filter((identity) =>
            !ownTypeParameterIdentities.has(identity)),
        ),
      });
  const decorators = (function_.decorators ?? []).map((decorator) =>
    text(printMojoDecorator(decorator)));
  const parameters = printFunctionParameters(function_, functionContext);
  const result = printMojoTypeDocument(function_.resultType, functionContext);
  const error = function_.errorType === undefined
    ? emptyDocument
    : concat(text(" "), requiredMojoTypeDocument(function_.errorType, functionContext));
  const captures = function_.captures === undefined
    ? emptyDocument
    : concat(text(" "), printLambdaCaptures(function_.captures));
  const signature = group(concat(
    text(function_.asynchronous ? `async def ${function_.name}` : `def ${function_.name}`),
    printMojoGenericParametersDocument(function_.genericParameters, context),
    parameters,
    function_.raises ? concat(text(" raises"), error) : emptyDocument,
    captures,
    result === undefined ? emptyDocument : concat(text(" -> "), result),
  ));
  const declaration = block(
    signature,
    function_.statements === undefined
      ? text("...")
      : printMojoBodyDocument(function_.statements, functionContext),
  );
  return decorators.length === 0
    ? declaration
    : concat(join(hardLine, decorators), hardLine, declaration);
}

function printFunctionParameters(
  function_: MojoFunctionDeclaration,
  context: MojoPrintContext,
): MojoDocument {
  const parameters: MojoDocument[] = function_.self === undefined ? [] : [text(function_.self)];
  let previousPosition: MojoParameter["position"] = "positional-or-keyword";
  for (const [index, parameter] of function_.parameters.entries()) {
    const position = parameter.position ?? "positional-or-keyword";
    if (position === "keyword" && previousPosition !== "keyword") parameters.push(text("*"));
    parameters.push(printParameterDocument(parameter, context));
    if (position === "positional" &&
      (function_.parameters[index + 1]?.position ?? "positional-or-keyword") !== "positional") {
      parameters.push(text("/"));
    }
    previousPosition = position;
  }
  return delimitedList("(", parameters, ")");
}

function printStructDocument(
  declaration: MojoStructDeclaration,
  context: MojoPrintContext,
): MojoDocument {
  const structTypeParameterIdentities = new Set(declaration.genericParameters.flatMap((parameter) =>
    parameter.identity === undefined ? [] : [parameter.identity]));
  const memberContext = structTypeParameterIdentities.size === 0
    ? context
    : Object.freeze({ ...context, structTypeParameterIdentities });
  const decorators = (declaration.decorators ?? []).map((decorator) =>
    text(printMojoDecorator(decorator)));
  const conformances = declaration.conformances.length === 0
    ? emptyDocument
    : delimitedList(
        "(",
        declaration.conformances.map((type) => requiredMojoTypeDocument(type, context)),
        ")",
      );
  const header = group(concat(
    text(`struct ${declaration.name}`),
    printMojoGenericParametersDocument(declaration.genericParameters, context),
    conformances,
  ));
  const members: MojoDocument[] = declaration.fields.map((field) => group(concat(
    text(`${field.compileTime ? "comptime" : "var"} ${field.name}: `),
    requiredMojoTypeDocument(field.type, memberContext),
    field.initializer === undefined
      ? emptyDocument
      : concat(text(" = "), printMojoExpressionDocument(field.initializer, memberContext)),
  )));
  for (const method of declaration.methods) {
    members.push(printMojoFunctionDocument(method, memberContext));
  }
  const fields = members.slice(0, declaration.fields.length);
  const methods = members.slice(declaration.fields.length);
  const body = fields.length === 0 && methods.length === 0
    ? text("pass")
    : fields.length === 0
      ? join(concat(hardLine, hardLine), methods)
      : methods.length === 0
        ? join(hardLine, fields)
        : concat(
            join(hardLine, fields),
            hardLine,
            hardLine,
            join(concat(hardLine, hardLine), methods),
          );
  const result = block(header, body);
  return decorators.length === 0
    ? result
    : concat(join(hardLine, decorators), hardLine, result);
}

function printMojoDecorator(
  decorator: import("../../backend/target-ast/index.js").MojoDecorator,
): string {
  switch (decorator) {
    case "fieldwise-init": return "@fieldwise_init";
    case "static-method": return "@staticmethod";
  }
}

function printTraitDocument(
  declaration: MojoTraitDeclaration,
  context: MojoPrintContext,
): MojoDocument {
  const parents = declaration.parents.length === 0
    ? emptyDocument
    : delimitedList(
        "(",
        declaration.parents.map((type) => requiredMojoTypeDocument(type, context)),
        ")",
      );
  const methods = declaration.methods.map((method) => printMojoFunctionDocument({
    ...method,
    statements: undefined,
  }, context));
  return block(
    group(concat(text(`trait ${declaration.name}`), parents)),
    methods.length === 0
      ? text("pass")
      : join(concat(hardLine, hardLine), methods),
  );
}
