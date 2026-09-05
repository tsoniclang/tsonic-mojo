import type { MojoOriginRef, MojoOriginToken } from "./model.js";

export interface MojoParsedProviderOrigin {
  readonly origin: MojoOriginRef;
  readonly mutable: boolean;
}

export function parseMojoProviderOrigin(
  text: string,
  originParameters: ReadonlySet<string> = new Set(),
): MojoOriginRef {
  return parseMojoProviderReferenceOrigin(text, originParameters).origin;
}

export function parseMojoProviderReferenceOrigin(
  text: string,
  originParameters: ReadonlySet<string> = new Set(),
): MojoParsedProviderOrigin {
  const trimmed = text.trim();
  if (originParameters.has(trimmed)) {
    return Object.freeze({
      origin: Object.freeze({ kind: "parameter", name: trimmed }),
      mutable: false,
    });
  }
  if (trimmed === "static" || trimmed === "comptime") {
    return Object.freeze({ origin: Object.freeze({ kind: trimmed }), mutable: false });
  }
  if (trimmed === "_") {
    return Object.freeze({ origin: Object.freeze({ kind: "inferred" }), mutable: false });
  }
  const tokens = Object.freeze(tokenizeOrigin(trimmed));
  const known = knownOrigin(tokens);
  return known ?? Object.freeze({
    origin: Object.freeze({ kind: "provider-expression", tokens }),
    mutable: explicitMutableArgument(tokens),
  });
}

function knownOrigin(tokens: readonly MojoOriginToken[]): MojoParsedProviderOrigin | undefined {
  const head = tokens.length === 1 && tokens[0]?.kind === "identifier"
    ? tokens[0].text
    : undefined;
  if (head === "UntrackedOrigin" || head === "MutUntrackedOrigin") {
    const mutable = head === "MutUntrackedOrigin";
    return Object.freeze({ origin: Object.freeze({ kind: "untracked", mutable }), mutable });
  }
  if (head === "AnyOrigin" || head === "MutAnyOrigin" || head === "UnsafeAnyOrigin" ||
    head === "MutUnsafeAnyOrigin") {
    const mutable = head === "MutAnyOrigin" || head === "MutUnsafeAnyOrigin";
    return Object.freeze({ origin: Object.freeze({ kind: "unsafe", mutable }), mutable });
  }
  const genericHead = tokens[0]?.kind === "identifier" ? tokens[0].text : undefined;
  if (genericHead !== "UntrackedOrigin" && genericHead !== "AnyOrigin" &&
    genericHead !== "UnsafeAnyOrigin") return undefined;
  const mutable = explicitMutableArgument(tokens);
  return Object.freeze({
    origin: Object.freeze({
      kind: genericHead === "UntrackedOrigin" ? "untracked" : "unsafe",
      mutable,
    }),
    mutable,
  });
}

function explicitMutableArgument(tokens: readonly MojoOriginToken[]): boolean {
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (tokens[index]?.kind === "identifier" && tokens[index]?.text === "mut" &&
      tokens[index + 1]?.text === "=" && tokens[index + 2]?.kind === "identifier" &&
      tokens[index + 2]?.text === "True") return true;
  }
  return false;
}

function tokenizeOrigin(text: string): readonly MojoOriginToken[] {
  const tokens: MojoOriginToken[] = [];
  for (let index = 0; index < text.length;) {
    const character = text[index]!;
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = index++;
      while (index < text.length && /[A-Za-z0-9_]/u.test(text[index]!)) index += 1;
      tokens.push(Object.freeze({ kind: "identifier", text: text.slice(start, index) }));
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index++;
      while (index < text.length && /[0-9_]/u.test(text[index]!)) index += 1;
      tokens.push(Object.freeze({ kind: "number", text: text.slice(start, index) }));
      continue;
    }
    if (character === "\"" || character === "'") {
      const quote = character;
      const start = index++;
      let escaped = false;
      while (index < text.length) {
        const current = text[index++]!;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) break;
      }
      if (text[index - 1] !== quote) {
        throw new Error(`Mojo compiler emitted an unterminated origin literal '${text}'.`);
      }
      tokens.push(Object.freeze({ kind: "string", text: text.slice(start, index) }));
      continue;
    }
    tokens.push(Object.freeze({ kind: "punctuation", text: character }));
    index += 1;
  }
  if (tokens.length === 0) {
    throw new Error("Mojo compiler emitted an empty origin expression.");
  }
  return tokens;
}
