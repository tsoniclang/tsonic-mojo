import type { MojoDocument } from "./model.js";

interface RenderCommand {
  readonly indentation: number;
  readonly mode: "flat" | "break";
  readonly document: MojoDocument;
}

export interface MojoDocumentRenderOptions {
  readonly width?: number;
  readonly finalNewline?: boolean;
}

export function renderMojoDocument(
  document: MojoDocument,
  options: MojoDocumentRenderOptions = {},
): string {
  const width = options.width ?? 80;
  if (!Number.isSafeInteger(width) || width < 20) {
    throw new Error("Mojo document width must be a safe integer of at least 20 columns.");
  }
  const output: string[] = [];
  const stack: RenderCommand[] = [{ indentation: 0, mode: "break", document }];
  let column = 0;
  while (stack.length > 0) {
    const command = stack.pop()!;
    const current = command.document;
    switch (current.kind) {
      case "empty": break;
      case "text":
        output.push(current.value);
        column += current.value.length;
        break;
      case "concat":
        pushDocuments(stack, command.indentation, command.mode, current.documents);
        break;
      case "line":
        if (!current.hard && command.mode === "flat") {
          output.push(current.flatText);
          column += current.flatText.length;
        } else {
          output.push("\n", " ".repeat(command.indentation));
          column = command.indentation;
        }
        break;
      case "indent":
        stack.push({
          indentation: command.indentation + current.amount,
          mode: command.mode,
          document: current.document,
        });
        break;
      case "group": {
        const flattened: RenderCommand = {
          indentation: command.indentation,
          mode: "flat",
          document: current.document,
        };
        stack.push(fits(width - column, [...stack, flattened]) ? flattened : {
          ...flattened,
          mode: "break",
        });
        break;
      }
      case "if-break":
        stack.push({
          indentation: command.indentation,
          mode: command.mode,
          document: command.mode === "break" ? current.broken : current.flat,
        });
        break;
    }
  }
  const rendered = output.join("").replace(/[ \t]+(?=\n|$)/gu, "");
  return options.finalNewline === false || rendered.endsWith("\n")
    ? rendered
    : `${rendered}\n`;
}

function fits(remainingWidth: number, commands: RenderCommand[]): boolean {
  let remaining = remainingWidth;
  while (remaining >= 0 && commands.length > 0) {
    const command = commands.pop()!;
    const current = command.document;
    switch (current.kind) {
      case "empty": break;
      case "text": remaining -= current.value.length; break;
      case "concat":
        pushDocuments(commands, command.indentation, command.mode, current.documents);
        break;
      case "line":
        if (current.hard || command.mode === "break") return true;
        remaining -= current.flatText.length;
        break;
      case "indent":
        commands.push({ ...command, indentation: command.indentation + current.amount, document: current.document });
        break;
      case "group":
        commands.push({ ...command, mode: "flat", document: current.document });
        break;
      case "if-break":
        commands.push({ ...command, document: command.mode === "break" ? current.broken : current.flat });
        break;
    }
  }
  return remaining >= 0;
}

function pushDocuments(
  stack: RenderCommand[],
  indentation: number,
  mode: RenderCommand["mode"],
  documents: readonly MojoDocument[],
): void {
  for (let index = documents.length - 1; index >= 0; index -= 1) {
    stack.push({ indentation, mode, document: documents[index]! });
  }
}
