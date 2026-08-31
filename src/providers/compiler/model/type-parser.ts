import type {
  MojoCompilerType,
  MojoCompilerTypeArgument,
} from "./model.js";

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
  if (text.startsWith("def(")) return parseFunctionType(text, scope);
  if (text.startsWith("(") && matchingDelimiter(text, 0, "(", ")") === text.length - 1) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return Object.freeze({ kind: "tuple", elements: Object.freeze([]) });
    return Object.freeze({
      kind: "tuple",
      elements: Object.freeze(splitTopLevel(inner).map((part) =>
        parseMojoCompilerType(part, undefined, scope))),
    });
  }
  const bracket = firstTopLevelDelimiter(text, "[");
  const name = bracket === undefined ? text : text.slice(0, bracket).trim();
  if (!qualifiedIdentifierPattern.test(name)) {
    throw new Error(`Mojo compiler type '${text}' has an unsupported nominal head '${name}'.`);
  }
  if (name === "Self" || name === "_Self" || name.startsWith("Self.") || name.startsWith("_Self.")) {
    if (bracket !== undefined) {
      throw new Error(`Mojo compiler self type '${text}' cannot carry unclassified arguments.`);
    }
    return Object.freeze({
      kind: "self",
      memberPath: Object.freeze(name.split(".").slice(1)),
    });
  }
  if (bracket === undefined) {
    if (scope.typeParameters?.has(name) === true) {
      return Object.freeze({ kind: "type-parameter", name });
    }
    return Object.freeze({ kind: "named", name, ...(path === undefined ? {} : { path }), arguments: Object.freeze([]) });
  }
  const close = matchingDelimiter(text, bracket, "[", "]");
  if (close !== text.length - 1) {
    throw new Error(`Mojo compiler type '${text}' has trailing data after its type arguments.`);
  }
  const argumentText = text.slice(bracket + 1, close).trim();
  const arguments_ = argumentText.length === 0
    ? []
    : splitTopLevel(argumentText).map((part) => parseTypeArgument(part, scope));
  return Object.freeze({
    kind: "named",
    name,
    ...(path === undefined ? {} : { path }),
    arguments: Object.freeze(arguments_),
  });
}

function parseFunctionType(
  text: string,
  scope: MojoCompilerTypeScope,
): MojoCompilerType {
  const close = matchingDelimiter(text, 3, "(", ")");
  const parametersText = text.slice(4, close).trim();
  const parameters = parametersText.length === 0
    ? []
    : splitTopLevel(parametersText).map((entry) => {
        const colon = firstTopLevelDelimiter(entry, ":");
        return parseMojoCompilerType(colon === undefined ? entry : entry.slice(colon + 1), undefined, scope);
      });
  let suffix = text.slice(close + 1).trim();
  let thin = false;
  let raises = false;
  let errorType: MojoCompilerType | undefined;
  if (suffix.startsWith("thin")) {
    thin = true;
    suffix = suffix.slice(4).trim();
  }
  if (suffix.startsWith("raises")) {
    raises = true;
    suffix = suffix.slice(6).trim();
    const arrow = findTopLevelArrow(suffix);
    const errorText = (arrow === undefined ? suffix : suffix.slice(0, arrow)).trim();
    if (errorText.length > 0) errorType = parseMojoCompilerType(errorText, undefined, scope);
    suffix = arrow === undefined ? "" : suffix.slice(arrow).trim();
  }
  let result: MojoCompilerType | undefined;
  if (suffix.length > 0) {
    if (!suffix.startsWith("->")) {
      throw new Error(`Mojo compiler function type '${text}' has unsupported effects '${suffix}'.`);
    }
    result = parseMojoCompilerType(suffix.slice(2), undefined, scope);
  }
  return Object.freeze({
    kind: "function",
    parameters: Object.freeze(parameters),
    ...(result === undefined ? {} : { result }),
    thin,
    raises,
    ...(errorType === undefined ? {} : { errorType }),
  });
}

function parseTypeArgument(
  expression: string,
  scope: MojoCompilerTypeScope,
): MojoCompilerTypeArgument {
  const text = expression.trim();
  if (text === "_" || text === "...") return Object.freeze({ kind: "unbound" });
  if (scope.typeParameters?.has(text) === true || builtinTypes.has(text) ||
    text.startsWith("Self") || text.startsWith("_Self") || text.startsWith("ref[") ||
    text.startsWith("def(") || text.startsWith("(")) {
    return Object.freeze({ kind: "type", type: parseMojoCompilerType(text, undefined, scope) });
  }
  if (scope.valueParameters?.has(text) === true || scope.originParameters?.has(text) === true ||
    isUnambiguousValueExpression(text, scope)) {
    return Object.freeze({ kind: "value", expression: text });
  }
  const nestedBracket = firstTopLevelDelimiter(text, "[");
  if (nestedBracket !== undefined) {
    return Object.freeze({ kind: "type", type: parseMojoCompilerType(text, undefined, scope) });
  }
  throw new Error(
    `Mojo compiler generic argument '${text}' is not classified by machine-readable metadata.`,
  );
}

function isUnambiguousValueExpression(
  text: string,
  scope: MojoCompilerTypeScope,
): boolean {
  if (/^(?:True|False|None|-?[0-9]+(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*")$/u.test(text)) return true;
  if (!isBalancedExpression(text) || !/^[A-Za-z0-9_., +*/%()\[\]-]+$/u.test(text)) return false;
  const first = /^[_A-Za-z][_A-Za-z0-9]*/u.exec(text)?.[0];
  return first !== undefined &&
    (scope.valueParameters?.has(first) === true || scope.originParameters?.has(first) === true || text.includes("."));
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  const stack: string[] = [];
  let quoted: '"' | "'" | undefined;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quoted) quoted = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quoted = character;
      continue;
    }
    if (character === "[" || character === "(") stack.push(character);
    else if (character === "]" || character === ")") {
      const expected = character === "]" ? "[" : "(";
      if (stack.pop() !== expected) throw new Error(`Unbalanced Mojo compiler expression '${text}'.`);
    } else if (character === "," && stack.length === 0) {
      const part = text.slice(start, index).trim();
      if (part.length === 0) throw new Error(`Empty Mojo compiler expression component in '${text}'.`);
      parts.push(part);
      start = index + 1;
    }
  }
  if (quoted !== undefined || stack.length !== 0) throw new Error(`Unbalanced Mojo compiler expression '${text}'.`);
  const tail = text.slice(start).trim();
  if (tail.length === 0) throw new Error(`Empty Mojo compiler expression component in '${text}'.`);
  parts.push(tail);
  return parts;
}

function matchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
  if (text[openIndex] !== open) throw new Error(`Expected '${open}' in Mojo compiler expression '${text}'.`);
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced Mojo compiler expression '${text}'.`);
}

function firstTopLevelDelimiter(text: string, delimiter: string): number | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === delimiter && square === 0 && round === 0) return index;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    if (square < 0 || round < 0) throw new Error(`Unbalanced Mojo compiler expression '${text}'.`);
  }
  if (square !== 0 || round !== 0) throw new Error(`Unbalanced Mojo compiler expression '${text}'.`);
  return undefined;
}

function findTopLevelArrow(text: string): number | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index + 1 < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "-" && text[index + 1] === ">" && square === 0 && round === 0) return index;
  }
  return undefined;
}

function isBalancedExpression(text: string): boolean {
  try {
    splitTopLevel(text);
    return true;
  } catch {
    return false;
  }
}

export function isMojoCompilerIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}
