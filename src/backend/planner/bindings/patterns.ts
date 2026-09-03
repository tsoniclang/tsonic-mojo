import type {
  MojoBindingPatternElementSelection,
  MojoBindingPatternSelection,
  MojoBindingValueProjection,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { allocateMojoSyntheticName } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import type { MojoValuePlanner } from "../expressions/support.js";
import { registerMojoTypeImports } from "../types/imports.js";

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
  if (selection.sourceReuse === "direct" && source.before.length !== 0) return undefined;
  const projectionSource = selection.sourceReuse === "direct" ? source.value : sourcePath;
  const statements: MojoStatement[] = selection.sourceReuse === "direct"
    ? []
    : [
        ...source.before,
        Object.freeze({
          kind: "variable",
          name: sourceName,
          type: selection.sourceType,
          initializer: source.value,
        }),
      ];
  if (!planElements(
    selection.elements,
    projectionSource,
    selection.sourceType,
    statements,
    context,
    planValue,
  )) return undefined;
  return Object.freeze(statements);
}

function planElements(
  elements: readonly MojoBindingPatternElementSelection[],
  source: MojoExpression,
  sourceType: MojoTargetTypeRef,
  statements: MojoStatement[],
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): boolean {
  for (const element of elements) {
    registerMojoTypeImports(element.projectedType, context);
    const projected = projectionExpression(source, sourceType, element);
    if (projected === undefined) return false;
    const targetType = element.target.type;
    registerMojoTypeImports(targetType, context);
    const targetName = element.target.kind === "binding"
      ? element.target.name
      : allocateMojoSyntheticName(context, "binding_nested");
    if (!planNormalizedBinding(
      targetName,
      targetType,
      projected,
      element,
      statements,
      context,
      planValue,
    )) return false;
    if (element.target.kind === "binding") continue;
    if (!planElements(
      element.target.elements,
      Object.freeze({ kind: "path", path: targetName }),
      element.target.type,
      statements,
      context,
      planValue,
    )) return false;
  }
  return true;
}

function planNormalizedBinding(
  name: string,
  type: MojoTargetTypeRef,
  projected: MojoExpression,
  element: MojoBindingPatternElementSelection,
  statements: MojoStatement[],
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): boolean {
  if (element.normalization === "identity") {
    statements.push(Object.freeze({ kind: "variable", name, type, initializer: projected }));
    return true;
  }
  if (element.initializer === undefined || element.projectedType.kind !== "optional") return false;
  const fallback = planValue(element.initializer, context, type);
  if (fallback === undefined) return false;
  const projectedName = allocateMojoSyntheticName(context, "binding_optional");
  const projectedPath: MojoExpression = Object.freeze({ kind: "path", path: projectedName });
  statements.push(
    Object.freeze({
      kind: "variable",
      name: projectedName,
      type: element.projectedType,
      initializer: projected,
    }),
    Object.freeze({ kind: "variable", name, type }),
    Object.freeze({
      kind: "if",
      condition: projectedPath,
      thenStatements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({ kind: "path", path: name }),
        right: Object.freeze({
          kind: "method-call",
          receiver: projectedPath,
          name: "value",
          arguments: Object.freeze([]),
        }),
      })]),
      elseStatements: Object.freeze([
        ...fallback.before,
        Object.freeze({
          kind: "assignment",
          operator: "=",
          left: Object.freeze({ kind: "path", path: name }),
          right: fallback.value,
        }),
      ]),
    }),
  );
  return true;
}

function projectionExpression(
  source: MojoExpression,
  sourceType: MojoTargetTypeRef,
  element: MojoBindingPatternElementSelection,
): MojoExpression | undefined {
  const projection = element.projection;
  switch (projection.kind) {
    case "element":
      return indexed(source, projection.index);
    case "list-element": {
      const value = indexed(source, projection.index);
      if (!projection.checked) return value;
      if (element.projectedType.kind !== "optional") return undefined;
      return Object.freeze({
        kind: "conditional",
        condition: Object.freeze({
          kind: "binary",
          operator: "<",
          left: integer(projection.index),
          right: Object.freeze({
            kind: "method-call",
            receiver: source,
            name: "__len__",
            arguments: Object.freeze([]),
          }),
        }),
        whenTrue: Object.freeze({
          kind: "construct",
          type: element.projectedType,
          arguments: Object.freeze([Object.freeze({ value })]),
        }),
        whenFalse: Object.freeze({ kind: "none-literal" }),
      });
    }
    case "project-field":
      return Object.freeze({
        kind: "member",
        receiver: dereferencedState(source),
        name: projection.name,
      });
    case "structural-field":
      return indexed(dereferencedState(source), projection.storageIndex);
    case "dictionary-key":
      return Object.freeze({
        kind: "element",
        receiver: source,
        index: Object.freeze({ kind: "string-literal", value: projection.key }),
      });
    case "tuple-rest":
      return sourceType.kind !== "tuple"
        ? undefined
        : Object.freeze({
            kind: "tuple",
            elements: Object.freeze(sourceType.elements.slice(projection.start)
              .map((_, offset) => indexed(source, projection.start + offset))),
          });
    case "fixed-array-rest":
      return planFixedArrayRest(source, sourceType, element.projectedType, projection.start);
    case "list-rest":
      return sourceType.kind !== "list" || element.projectedType.kind !== "list"
        ? undefined
        : Object.freeze({
            kind: "construct",
            type: element.projectedType,
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({ kind: "slice", receiver: source, start: integer(projection.start) }),
            })]),
          });
    case "object-rest":
      return planObjectRest(source, element.projectedType, projection.fields);
  }
}

function planFixedArrayRest(
  source: MojoExpression,
  sourceType: MojoTargetTypeRef,
  targetType: MojoTargetTypeRef,
  start: number,
): MojoExpression | undefined {
  if (sourceType.kind !== "fixed-array" || sourceType.length.kind !== "integer") return undefined;
  const length = Number(sourceType.length.value);
  if (!Number.isSafeInteger(length) || length < start) return undefined;
  const values = Object.freeze(Array.from(
    { length: length - start },
    (_, offset) => indexed(source, start + offset),
  ));
  if (targetType.kind === "fixed-array") return Object.freeze({ kind: "list", elements: values });
  return targetType.kind === "list"
    ? Object.freeze({
        kind: "construct",
        type: targetType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "slice", receiver: source, start: integer(start) }),
        })]),
      })
    : undefined;
}

function planObjectRest(
  source: MojoExpression,
  targetType: MojoTargetTypeRef,
  fields: Extract<MojoBindingPatternElementSelection["projection"], {
    readonly kind: "object-rest";
  }>["fields"],
): MojoExpression | undefined {
  if (targetType.kind !== "target-named") return undefined;
  const ordered = [...fields].sort((left, right) => left.targetStorageIndex - right.targetStorageIndex);
  const storageArgument = targetType.genericArguments?.[0];
  if (storageArgument?.kind !== "type" || storageArgument.type.kind !== "tuple") return undefined;
  const storageType = storageArgument.type;
  if (storageType.elements.length !== ordered.length ||
    ordered.some((field, index) => field.targetStorageIndex !== index ||
      !mojoTargetTypeEquals(field.sourceType, storageType.elements[index]!))) return undefined;
  const values = ordered.map((field) => projectionValue(source, field.source));
  if (values.some((value) => value === undefined)) return undefined;
  return Object.freeze({
    kind: "construct",
    type: targetType,
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({
        kind: "tuple",
        elements: Object.freeze(values as readonly MojoExpression[]),
      }),
    })]),
  });
}

function projectionValue(
  source: MojoExpression,
  projection: MojoBindingValueProjection,
): MojoExpression | undefined {
  switch (projection.kind) {
    case "element": return indexed(source, projection.index);
    case "list-element": return projection.checked ? undefined : indexed(source, projection.index);
    case "project-field": return Object.freeze({
      kind: "member",
      receiver: dereferencedState(source),
      name: projection.name,
    });
    case "structural-field": return indexed(dereferencedState(source), projection.storageIndex);
    case "dictionary-key": return Object.freeze({
      kind: "element",
      receiver: source,
      index: Object.freeze({ kind: "string-literal", value: projection.key }),
    });
  }
}

function dereferencedState(source: MojoExpression): MojoExpression {
  return Object.freeze({
    kind: "postfix-deref",
    expression: Object.freeze({ kind: "member", receiver: source, name: "_state" }),
  });
}

function indexed(source: MojoExpression, index: number): MojoExpression {
  return Object.freeze({ kind: "element", receiver: source, index: integer(index) });
}

function integer(value: number): MojoExpression {
  return Object.freeze({ kind: "number-literal", text: String(value) });
}
