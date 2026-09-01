import type {
  MojoBindingPatternElementSelection,
  MojoBindingPatternSelection,
} from "../../analysis/program/model.js";
import type { MojoExpression, MojoStatement } from "../target-ast/nodes.js";
import { allocateMojoSyntheticName } from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import type { MojoValuePlanner } from "./expression-support.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoBindingPattern(
  selection: MojoBindingPatternSelection,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): readonly MojoStatement[] | undefined {
  const source = planValue(selection.initializer, context, selection.sourceType);
  if (source === undefined) return undefined;
  registerMojoTypeImports(selection.sourceType, context);
  const sourceName = allocateMojoSyntheticName(context, "binding_source");
  const sourcePath: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const statements: MojoStatement[] = [
    ...source.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      type: selection.sourceType,
      initializer: source.value,
    }),
  ];
  if (!planElements(selection.elements, sourcePath, statements, context)) return undefined;
  return Object.freeze(statements);
}

function planElements(
  elements: readonly MojoBindingPatternElementSelection[],
  source: MojoExpression,
  statements: MojoStatement[],
  context: MojoPlanningContext,
): boolean {
  for (const element of elements) {
    registerMojoTypeImports(element.projectedType, context);
    const projected = projectionExpression(source, element);
    if (element.target.kind === "binding") {
      statements.push(Object.freeze({
        kind: "variable",
        name: element.target.name,
        type: element.target.type,
        initializer: projected,
      }));
      continue;
    }
    const nestedName = allocateMojoSyntheticName(context, "binding_nested");
    const nestedPath: MojoExpression = Object.freeze({ kind: "path", path: nestedName });
    statements.push(Object.freeze({
      kind: "variable",
      name: nestedName,
      type: element.projectedType,
      initializer: projected,
    }));
    if (!planElements(element.target.elements, nestedPath, statements, context)) return false;
  }
  return true;
}

function projectionExpression(
  source: MojoExpression,
  element: MojoBindingPatternElementSelection,
): MojoExpression {
  switch (element.projection.kind) {
    case "element":
      return Object.freeze({
        kind: "element",
        receiver: source,
        index: Object.freeze({ kind: "number-literal", text: String(element.projection.index) }),
      });
    case "project-field":
      return Object.freeze({
        kind: "member",
        receiver: Object.freeze({
          kind: "postfix-deref",
          expression: Object.freeze({ kind: "member", receiver: source, name: "_state" }),
        }),
        name: element.projection.name,
      });
    case "dictionary-key":
      return Object.freeze({
        kind: "element",
        receiver: source,
        index: Object.freeze({ kind: "string-literal", value: element.projection.key }),
      });
  }
}
