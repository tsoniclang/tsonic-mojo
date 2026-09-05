import type { MojoDocument } from "./model.js";

export const emptyDocument: MojoDocument = Object.freeze({ kind: "empty" });
export const line: MojoDocument = Object.freeze({ kind: "line", flatText: " ", hard: false });
export const softLine: MojoDocument = Object.freeze({ kind: "line", flatText: "", hard: false });
export const hardLine: MojoDocument = Object.freeze({ kind: "line", flatText: "", hard: true });

export function text(value: string): MojoDocument {
  if (value.length === 0) return emptyDocument;
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Mojo document text must not contain line terminators.");
  }
  return Object.freeze({ kind: "text", value });
}

export function concat(...documents: readonly MojoDocument[]): MojoDocument {
  const flattened = documents.flatMap((document) =>
    document.kind === "empty"
      ? []
      : document.kind === "concat"
        ? document.documents
        : [document]);
  if (flattened.length === 0) return emptyDocument;
  if (flattened.length === 1) return flattened[0]!;
  return Object.freeze({ kind: "concat", documents: Object.freeze(flattened) });
}

export function join(
  separator: MojoDocument,
  documents: readonly MojoDocument[],
): MojoDocument {
  if (documents.length === 0) return emptyDocument;
  const result: MojoDocument[] = [documents[0]!];
  for (let index = 1; index < documents.length; index += 1) {
    result.push(separator, documents[index]!);
  }
  return concat(...result);
}

export function indent(amount: number, document: MojoDocument): MojoDocument {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Mojo document indentation must be a non-negative safe integer.");
  }
  if (amount === 0 || document.kind === "empty") return document;
  return Object.freeze({ kind: "indent", amount, document });
}

export function group(document: MojoDocument): MojoDocument {
  return document.kind === "empty"
    ? document
    : Object.freeze({ kind: "group", document });
}

export function ifBreak(
  broken: MojoDocument,
  flat: MojoDocument = emptyDocument,
): MojoDocument {
  return Object.freeze({ kind: "if-break", broken, flat });
}

export function chooseLayout(preferred: MojoDocument, expanded: MojoDocument): MojoDocument {
  return Object.freeze({ kind: "choice", preferred, expanded });
}

export function parenthesizedLayout(document: MojoDocument): MojoDocument {
  return chooseLayout(document, group(concat(
    ifBreak(text("(")),
    indent(4, concat(ifBreak(hardLine), document)),
    ifBreak(hardLine),
    ifBreak(text(")")),
  )));
}

export function delimitedList(
  open: string,
  documents: readonly MojoDocument[],
  close: string,
  options: { readonly trailingComma?: boolean } = {},
): MojoDocument {
  if (documents.length === 0) return text(`${open}${close}`);
  const trailing = options.trailingComma === false
    ? emptyDocument
    : ifBreak(text(","));
  return group(concat(
    text(open),
    indent(4, concat(
      softLine,
      join(concat(text(","), line), documents),
      trailing,
    )),
    softLine,
    text(close),
  ));
}

export function block(header: MojoDocument, body: MojoDocument): MojoDocument {
  return concat(header, text(":"), indent(4, concat(hardLine, body)));
}
