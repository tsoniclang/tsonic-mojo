import type {
  MojoCompilerType,
  MojoCompilerTypeArgument,
} from "./model.js";
import {
  findTopLevelArrow,
  firstTopLevelDelimiter,
  isBalancedExpression,
  lastTopLevelMemberSeparator,
  matchingDelimiter,
  splitTopLevel,
} from "./type-expression-scanner.js";

const identifierPattern = /^[_A-Za-z][_A-Za-z0-9]*$/u;
const qualifiedIdentifierPattern = /^[_A-Za-z][_A-Za-z0-9]*(?:\.[_A-Za-z][_A-Za-z0-9]*)*$/u;
const builtinTypes = new Set([
  "AnyType",
  "Bool",
  "DType",
  "Error",
  "Float16",
  "Float32",
  "Float64",
  "Int",
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "Never",
  "None",
  "NoneType",
  "Object",
  "Origin",
  "String",
  "UInt",
  "UInt8",
  "UInt16",
  "UInt32",
  "UInt64",
]);

export interface MojoCompilerTypeScope {
  readonly typeParameters?: ReadonlySet<string>;
  readonly valueParameters?: ReadonlySet<string>;
  readonly originParameters?: ReadonlySet<string>;
  readonly genericTypeParameters?: ReadonlyMap<string, readonly import("./model.js").MojoCompilerGenericParameter[]>;
  readonly resolveTypePath?: (name: string, compilerPath?: string) => string | undefined;
}

export function parseMojoCompilerType(
  expression: string,
  path: string | undefined,
  scope: MojoCompilerTypeScope = {},
): MojoCompilerType {
  const text = expression.trim();
  if (text.length === 0) throw new Error("Mojo compiler emitted an empty type expression.");
  if (text.startsWith("ref[")) {
    const close = matchingDelimiter(text, 3, "[", "]");
    const origin = text.slice(4, close).trim();
    const target = text.slice(close + 1).trim();
    if (origin.length === 0 || target.length === 0 || !isBalancedExpression(origin)) {
      throw new Error(`Mojo compiler emitted invalid reference type '${text}'.`);
    }
    return Object.freeze({
      kind: "reference",
      origin,
      target: parseMojoCompilerType(target, path, scope),
    });
  }
  if (text.startsWith("def(") || text.startsWith("def[") || text.startsWith("async def(") ||
    text.startsWith("async def[")) return parseFunctionType(text, scope);
  if (text.startsWith("(") && matchingDelimiter(text, 0, "(", ")") === text.length - 1) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return Object.freeze({ kind: "tuple", elements: Object.freeze([]) });
    return Object.freeze({
      kind: "tuple",
      elements: Object.freeze(splitTopLevel(inner).map((part) =>
        parseMojoCompilerType(part, undefined, scope))),
    });
  }
  const associated = parseAssociatedType(text, path, scope);
  if (associated !== undefined) return associated;
  const bracket = firstTopLevelDelimiter(text, "[");
  const name = bracket === undefined ? text : text.slice(0, bracket).trim();
  if (!qualifiedIdentifierPattern.test(name)) {
    throw new Error(`Mojo compiler type '${text}' has an unsupported nominal head '${name}'.`);
  }
  if (name === "Self" || name === "_Self" || name.startsWith("Self.") || name.startsWith("_Self.")) {
    const close = bracket === undefined ? undefined : matchingDelimiter(text, bracket, "[", "]");
    if (close !== undefined && close !== text.length - 1) {
      throw new Error(`Mojo compiler self type '${text}' has trailing data after its type arguments.`);
    }
    const arguments_ = bracket === undefined
      ? []
      : splitTopLevel(text.slice(bracket + 1, close)).map((part) => parseTypeArgument(part, scope));
    return Object.freeze({
      kind: "self",
      memberPath: Object.freeze(name.split(".").slice(1)),
      arguments: Object.freeze(arguments_),
    });
  }
  if (bracket === undefined) {
    if (scope.typeParameters?.has(name) === true) {
      return Object.freeze({ kind: "type-parameter", name });
    }
    const resolvedPath = builtinTypes.has(name) ? path : scope.resolveTypePath?.(name, path) ?? path;
    if (resolvedPath === undefined && scope.resolveTypePath !== undefined && !builtinTypes.has(name)) {
      return Object.freeze({ kind: "compiler-expression", expression: text });
    }
    return Object.freeze({
      kind: "named",
      name,
      ...(resolvedPath === undefined ? {} : { path: resolvedPath }),
      arguments: Object.freeze([]),
    });
  }
  const close = matchingDelimiter(text, bracket, "[", "]");
  if (close !== text.length - 1) {
    throw new Error(`Mojo compiler type '${text}' has trailing data after its type arguments.`);
  }
  const argumentText = text.slice(bracket + 1, close).trim();
  const arguments_ = argumentText.length === 0
    ? []
    : parseTypeArguments(name, splitTopLevel(argumentText), scope);
  const resolvedPath = builtinTypes.has(name) ? path : scope.resolveTypePath?.(name, path) ?? path;
  if (resolvedPath === undefined && scope.resolveTypePath !== undefined && !builtinTypes.has(name)) {
    return Object.freeze({ kind: "compiler-expression", expression: text });
  }
  return Object.freeze({
    kind: "named",
    name,
    ...(resolvedPath === undefined ? {} : { path: resolvedPath }),
    arguments: Object.freeze(arguments_),
  });
}

function parseAssociatedType(
  text: string,
  path: string | undefined,
  scope: MojoCompilerTypeScope,
): MojoCompilerType | undefined {
  if (path !== undefined) return undefined;
  const separator = lastTopLevelMemberSeparator(text);
  if (separator === undefined) {
    const segments = text.split(".");
    if (segments.length < 2 || scope.typeParameters?.has(segments[0]!) !== true) return undefined;
    return Object.freeze({
      kind: "associated",
      owner: Object.freeze({ kind: "type-parameter", name: segments[0]! }),
      memberPath: Object.freeze(segments.slice(1)),
      arguments: Object.freeze([]),
    });
  }
  const ownerText = text.slice(0, separator).trim();
  const memberText = text.slice(separator + 1).trim();
  if (ownerText.length === 0 || memberText.length === 0) return undefined;
  const memberBracket = firstTopLevelDelimiter(memberText, "[");
  const memberName = memberBracket === undefined ? memberText : memberText.slice(0, memberBracket).trim();
  if (!qualifiedIdentifierPattern.test(memberName)) return undefined;
  let arguments_: readonly MojoCompilerTypeArgument[] = Object.freeze([]);
  if (memberBracket !== undefined) {
    const close = matchingDelimiter(memberText, memberBracket, "[", "]");
    if (close !== memberText.length - 1) return undefined;
    const parts = splitTopLevel(memberText.slice(memberBracket + 1, close));
    arguments_ = Object.freeze(parts.map((part) => parseTypeArgument(part, scope)));
  }
  return Object.freeze({
    kind: "associated",
    owner: parseMojoCompilerType(ownerText, undefined, scope),
    memberPath: Object.freeze(memberName.split(".")),
    arguments: arguments_,
  });
}

function parseFunctionType(
  text: string,
  scope: MojoCompilerTypeScope,
): MojoCompilerType {
  const asynchronous = text.startsWith("async ");
  const callable = asynchronous ? text.slice(6).trim() : text;
  if (!callable.startsWith("def")) {
    throw new Error(`Mojo compiler emitted invalid function type '${text}'.`);
  }
  let cursor = 3;
  let genericParameters: readonly import("./model.js").MojoCompilerGenericParameter[] = Object.freeze([]);
  let callableScope = scope;
  if (callable[cursor] === "[") {
    const genericClose = matchingDelimiter(callable, cursor, "[", "]");
    genericParameters = parseFunctionGenericParameters(
      callable.slice(cursor + 1, genericClose),
      scope,
    );
    callableScope = extendScope(scope, genericParameters);
    cursor = genericClose + 1;
  }
  if (callable[cursor] !== "(") {
    throw new Error(`Mojo compiler emitted invalid function type '${text}'.`);
  }
  const close = matchingDelimiter(callable, cursor, "(", ")");
  const parametersText = callable.slice(cursor + 1, close).trim();
  const parameters = parametersText.length === 0
    ? []
    : splitTopLevel(parametersText).map((entry) => parseCallableParameter(entry, callableScope));
  const suffix = callable.slice(close + 1).trim();
  const arrow = findTopLevelArrow(suffix);
  let effects = (arrow === undefined ? suffix : suffix.slice(0, arrow)).trim();
  let thin = false;
  let raises = false;
  let errorType: MojoCompilerType | undefined;
  let capture: string | undefined;
  while (effects.length > 0) {
    if (effects.startsWith("thin") && (effects.length === 4 || /\s/u.test(effects[4]!))) {
      if (thin) throw new Error(`Mojo compiler function type '${text}' repeats thin.`);
      thin = true;
      effects = effects.slice(4).trim();
      continue;
    }
    if (effects.startsWith("capturing") &&
      (effects.length === "capturing".length || effects["capturing".length] === "[" ||
        /\s/u.test(effects["capturing".length]!))) {
      if (capture !== undefined) throw new Error(`Mojo compiler function type '${text}' repeats capturing.`);
      effects = effects.slice("capturing".length).trim();
      if (effects.startsWith("[")) {
        const captureClose = matchingDelimiter(effects, 0, "[", "]");
        capture = effects.slice(1, captureClose).trim();
        effects = effects.slice(captureClose + 1).trim();
      } else {
        capture = "*";
      }
      if (capture.length === 0) {
        throw new Error(`Mojo compiler function type '${text}' has an empty capture origin.`);
      }
      continue;
    }
    if (effects.startsWith("raises") && (effects.length === 6 || /\s/u.test(effects[6]!))) {
      raises = true;
      const errorText = effects.slice(6).trim();
      if (errorText.length > 0) errorType = parseMojoCompilerType(errorText, undefined, callableScope);
      effects = "";
      continue;
    }
    throw new Error(`Mojo compiler function type '${text}' has unsupported effects '${effects}'.`);
  }
  const result = arrow === undefined
    ? undefined
    : parseMojoCompilerType(suffix.slice(arrow + 2), undefined, callableScope);
  return Object.freeze({
    kind: "function",
    genericParameters,
    parameters: Object.freeze(parameters),
    ...(result === undefined ? {} : { result }),
    asynchronous,
    thin,
    raises,
    ...(errorType === undefined ? {} : { errorType }),
    ...(capture === undefined ? {} : { capture }),
  });
}

function parseFunctionGenericParameters(
  text: string,
  parentScope: MojoCompilerTypeScope,
): readonly import("./model.js").MojoCompilerGenericParameter[] {
  if (text.trim().length === 0) return Object.freeze([]);
  const entries = splitTopLevel(text);
  const inferredBoundary = entries.indexOf("//");
  const positionalBoundary = entries.indexOf("/");
  const keywordBoundary = entries.indexOf("*");
  const declarations = entries
    .map((declaration, index) => Object.freeze({ declaration, index }))
    .filter(({ declaration }) => declaration !== "//" && declaration !== "/" && declaration !== "*");
  const result: import("./model.js").MojoCompilerGenericParameter[] = [];
  let scope = cloneScope(parentScope);
  for (const { declaration, index: originalIndex } of declarations) {
    const passingKind = inferredBoundary >= 0 && originalIndex < inferredBoundary
      ? "inferred" as const
      : positionalBoundary >= 0 && originalIndex < positionalBoundary
        ? "positional" as const
        : keywordBoundary >= 0 && originalIndex > keywordBoundary
          ? "keyword" as const
          : "positional-or-keyword" as const;
    const colon = firstTopLevelDelimiter(declaration, ":");
    if (colon === undefined) {
      throw new Error(`Mojo compiler function generic '${declaration}' has no constraint.`);
    }
    const rawName = declaration.slice(0, colon).trim();
    const variadic = rawName.startsWith("*");
    const name = variadic ? rawName.slice(1) : rawName;
    if (!identifierPattern.test(name)) {
      throw new Error(`Mojo compiler function generic '${rawName}' has an invalid name.`);
    }
    const assignment = splitTopLevelAssignment(declaration.slice(colon + 1));
    const constraintText = assignment?.left ?? declaration.slice(colon + 1).trim();
    const kind = genericParameterCategory(constraintText);
    const constraints = splitTopLevelIntersection(constraintText).map((constraint) =>
      parseMojoCompilerType(constraint, undefined, scope));
    const defaultArgument = assignment === undefined
      ? undefined
      : kind === "type"
        ? Object.freeze({
            kind: "type" as const,
            type: parseMojoCompilerType(assignment.right, undefined, scope),
          })
        : Object.freeze({ kind: "value" as const, expression: assignment.right });
    result.push(Object.freeze({
      kind,
      name,
      passingKind,
      variadic,
      constraints: Object.freeze(constraints),
      ...(defaultArgument === undefined ? {} : { defaultArgument }),
    }));
    scope = extendScope(scope, [result[result.length - 1]!]);
  }
  return Object.freeze(result);
}

function parseCallableParameter(
  expression: string,
  scope: MojoCompilerTypeScope,
): import("./model.js").MojoCompilerCallableParameter {
  const colon = firstTopLevelDelimiter(expression, ":");
  const left = (colon === undefined ? expression : expression.slice(0, colon)).trim();
  const right = colon === undefined ? undefined : expression.slice(colon + 1).trim();
  const conventionMatch = /^(imm|mut|var|ref|out|deinit)\b/u.exec(left);
  const convention = (conventionMatch?.[1] ?? "imm") as import("../../../target-model/provider/model.js").MojoCallArgumentConvention;
  let remainder = conventionMatch === null ? left : left.slice(conventionMatch[0].length).trim();
  let referenceOrigin: string | undefined;
  if (convention === "ref" && remainder.startsWith("[")) {
    const close = matchingDelimiter(remainder, 0, "[", "]");
    referenceOrigin = remainder.slice(1, close).trim();
    remainder = remainder.slice(close + 1).trim();
  }
  const name = right === undefined ? undefined : remainder;
  if (name !== undefined && !identifierPattern.test(name)) {
    throw new Error(`Mojo compiler function parameter '${expression}' has an invalid name.`);
  }
  const typeText = right ?? remainder;
  if (typeText.length === 0) {
    throw new Error(`Mojo compiler function parameter '${expression}' has no type.`);
  }
  const parsed = parseMojoCompilerType(typeText, undefined, scope);
  const type = referenceOrigin === undefined
    ? parsed
    : Object.freeze({ kind: "reference" as const, origin: referenceOrigin, target: parsed });
  return Object.freeze({
    ...(name === undefined ? {} : { name }),
    convention,
    type,
  });
}

function parseTypeArguments(
  ownerName: string,
  parts: readonly string[],
  scope: MojoCompilerTypeScope,
): readonly MojoCompilerTypeArgument[] {
  const parameters = scope.genericTypeParameters?.get(ownerName) ?? [];
  const positional = parameters.filter(({ passingKind }) => passingKind !== "inferred" && passingKind !== "keyword");
  let positionalIndex = 0;
  return Object.freeze(parts.map((part) => {
    const binding = namedArgument(part.trim());
    const expected = binding === undefined
      ? positional[positionalIndex++]
      : parameters.find(({ name }) => name === binding.name);
    return parseTypeArgument(part, scope, expected?.kind);
  }));
}

function parseTypeArgument(
  expression: string,
  scope: MojoCompilerTypeScope,
  expectedKind?: "type" | "value" | "origin",
): MojoCompilerTypeArgument {
  const text = expression.trim();
  const assignment = namedArgument(text);
  const name = assignment?.name;
  const value = assignment?.value ?? text;
  if (value === "_" || value === "...") {
    return Object.freeze({ kind: "unbound", ...(name === undefined ? {} : { name }) });
  }
  if (expectedKind === "value" || expectedKind === "origin") {
    if (!isBalancedExpression(value)) {
      throw new Error(`Mojo compiler generic value '${value}' is not balanced.`);
    }
    return Object.freeze({ kind: "value", ...(name === undefined ? {} : { name }), expression: value });
  }
  if (expectedKind === "type") {
    return Object.freeze({
      kind: "type",
      ...(name === undefined ? {} : { name }),
      type: parseMojoCompilerType(value, undefined, scope),
    });
  }
  const constrainedType = /^([_A-Za-z][_A-Za-z0-9]*)\((.+)\)$/u.exec(value);
  if (constrainedType !== null && scope.typeParameters?.has(constrainedType[1]!) === true &&
    isBalancedExpression(constrainedType[2]!)) {
    return Object.freeze({
      kind: "type-expression",
      ...(name === undefined ? {} : { name }),
      sourceType: Object.freeze({ kind: "type-parameter", name: constrainedType[1]! }),
      expression: value,
    });
  }
  if (scope.typeParameters?.has(value) === true || builtinTypes.has(value) ||
    value.startsWith("Self") || value.startsWith("_Self") || value.startsWith("ref[") ||
    value.startsWith("def(") || value.startsWith("def[") || value.startsWith("async def(") ||
    value.startsWith("async def[") || value.startsWith("(")) {
    return Object.freeze({
      kind: "type",
      ...(name === undefined ? {} : { name }),
      type: parseMojoCompilerType(value, undefined, scope),
    });
  }
  if (scope.valueParameters?.has(value) === true || scope.originParameters?.has(value) === true ||
    isUnambiguousValueExpression(value, scope)) {
    return Object.freeze({ kind: "value", ...(name === undefined ? {} : { name }), expression: value });
  }
  const nestedBracket = firstTopLevelDelimiter(value, "[");
  if (nestedBracket !== undefined) {
    return Object.freeze({
      kind: "type",
      ...(name === undefined ? {} : { name }),
      type: parseMojoCompilerType(value, undefined, scope),
    });
  }
  if (scope.resolveTypePath !== undefined && isBalancedExpression(value)) {
    return Object.freeze({
      kind: "compiler-expression",
      ...(name === undefined ? {} : { name }),
      expression: value,
    });
  }
  throw new Error(
    `Mojo compiler generic argument '${value}' is not classified by machine-readable metadata.`,
  );
}

function namedArgument(text: string): { readonly name: string; readonly value: string } | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "=" && square === 0 && round === 0) {
      const name = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim();
      if (!identifierPattern.test(name) || value.length === 0) {
        throw new Error(`Mojo compiler generic argument '${text}' has an invalid named binding.`);
      }
      return { name, value };
    }
  }
  return undefined;
}

function splitTopLevelAssignment(
  text: string,
): { readonly left: string; readonly right: string } | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "=" && square === 0 && round === 0) {
      const left = text.slice(0, index).trim();
      const right = text.slice(index + 1).trim();
      if (left.length === 0 || right.length === 0) {
        throw new Error(`Mojo compiler expression '${text}' has an invalid default.`);
      }
      return Object.freeze({ left, right });
    }
  }
  return undefined;
}

function splitTopLevelIntersection(text: string): readonly string[] {
  const parts: string[] = [];
  let square = 0;
  let round = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "&" && square === 0 && round === 0) {
      const part = text.slice(start, index).trim();
      if (part.length === 0) throw new Error(`Mojo compiler constraint '${text}' is invalid.`);
      parts.push(part);
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length === 0) throw new Error(`Mojo compiler constraint '${text}' is invalid.`);
  parts.push(tail);
  return Object.freeze(parts);
}

function genericParameterCategory(expression: string): "type" | "value" | "origin" {
  const head = /^[_A-Za-z][_A-Za-z0-9]*/u.exec(expression.trim())?.[0];
  if (head === "Origin" || head?.endsWith("Origin") === true) return "origin";
  return head !== undefined && valueGenericConstraintNames.has(head) ? "value" : "type";
}

function cloneScope(scope: MojoCompilerTypeScope): MojoCompilerTypeScope {
  return {
    typeParameters: new Set(scope.typeParameters ?? []),
    valueParameters: new Set(scope.valueParameters ?? []),
    originParameters: new Set(scope.originParameters ?? []),
    ...(scope.genericTypeParameters === undefined ? {} : { genericTypeParameters: scope.genericTypeParameters }),
    ...(scope.resolveTypePath === undefined ? {} : { resolveTypePath: scope.resolveTypePath }),
  };
}

function extendScope(
  scope: MojoCompilerTypeScope,
  parameters: readonly import("./model.js").MojoCompilerGenericParameter[],
): MojoCompilerTypeScope {
  const next = cloneScope(scope);
  for (const parameter of parameters) {
    if (parameter.kind === "type") (next.typeParameters as Set<string>).add(parameter.name);
    else if (parameter.kind === "value") (next.valueParameters as Set<string>).add(parameter.name);
    else (next.originParameters as Set<string>).add(parameter.name);
  }
  return next;
}

function isUnambiguousValueExpression(
  text: string,
  scope: MojoCompilerTypeScope,
): boolean {
  if (/^(?:True|False|None|-?[0-9]+(?:\.[0-9]+)?|\.[_A-Za-z][_A-Za-z0-9]*|"(?:[^"\\]|\\.)*")$/u.test(text)) return true;
  if (!isBalancedExpression(text) || !/^[A-Za-z0-9_., +*/%()\[\]"'-]+$/u.test(text)) return false;
  const first = /^[_A-Za-z][_A-Za-z0-9]*/u.exec(text)?.[0];
  return first !== undefined &&
    (scope.valueParameters?.has(first) === true || scope.originParameters?.has(first) === true ||
      text.includes(".") || /^[_A-Za-z][_A-Za-z0-9]*(?:\[[^\]]+\])?\(/u.test(text));
}

export function isMojoCompilerIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}

const valueGenericConstraintNames = new Set([
  "AddressSpace",
  "Bool",
  "DType",
  "Int",
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "SIMDLength",
  "UInt",
  "UInt8",
  "UInt16",
  "UInt32",
  "UInt64",
]);
