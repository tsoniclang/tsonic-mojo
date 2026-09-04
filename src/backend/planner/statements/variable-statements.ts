import type { Node } from "@tsonic/tsts";
import {
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { appendMojoPlanningDiagnostic } from "../program/context.js";
import { planMojoAssignment, planMojoValue, planMojoUpdate } from "../expressions/value.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoBindingPattern } from "../bindings/patterns.js";
import { planMojoResourceScope } from "./resources.js";
import { planMojoCompileTimeInitializer } from "../compile-time/values.js";

export function resourceDeclarationList(
  statement: Node,
  context: MojoPlanningContext,
): Node | undefined {
  const { ast } = context.program.source;
  if (!ast.is.IsVariableStatement(statement)) return undefined;
  const list = VariableStatement_DeclarationList(ast, statement);
  const kind = ast.variableDeclarationKind(list);
  return kind === "using" || kind === "await using" ? list : undefined;
}

export function planResourceDeclarations(
  declarations: readonly Node[],
  continuation: readonly MojoStatement[],
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  let protectedStatements = continuation;
  for (let index = declarations.length - 1; index >= 0; index -= 1) {
    const declaration = declarations[index]!;
    const acquisition = planVariableDeclaration(declaration, context);
    const scope = planMojoResourceScope(declaration, protectedStatements, context);
    if (acquisition === undefined || scope === undefined) return undefined;
    protectedStatements = Object.freeze([...acquisition, ...scope]);
  }
  return protectedStatements;
}

export function initializerResourceDeclarationList(
  initializer: Node | undefined,
  context: MojoPlanningContext,
): Node | undefined {
  if (initializer === undefined ||
    !context.program.source.ast.is.IsVariableDeclarationList(initializer)) return undefined;
  const kind = context.program.source.ast.variableDeclarationKind(initializer);
  return kind === "using" || kind === "await using" ? initializer : undefined;
}

export function planVariableDeclarationList(
  list: Node | undefined,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  if (list === undefined || !ast.is.IsVariableDeclarationList(list)) return undefined;
  const declarations = VariableDeclarationList_Declarations(ast, list) ?? [];
  const planned: MojoStatement[] = [];
  for (const declaration of declarations) {
    if (declaration === undefined) return undefined;
    const selected = planVariableDeclaration(declaration, context);
    if (selected === undefined) return undefined;
    planned.push(...selected);
  }
  return Object.freeze(planned);
}

function planVariableDeclaration(
  declaration: Node,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  const pattern = context.program.queries.bindingPatternSelection(declaration);
  if (pattern !== undefined) {
    const statements = planMojoBindingPattern(pattern, context, planMojoValue);
    if (statements === undefined) return undefined;
    return statements;
  }
  const name = context.program.queries.bindingName(declaration);
  const type = context.program.queries.bindingType(declaration);
  const sourceInitializer = Node_Initializer(ast, declaration);
  if (name === undefined || type === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_VARIABLE_BINDING_NOT_CLOSED",
      "A variable declaration requires one exact target name and sealed Mojo carrier.",
      declaration,
    );
    return undefined;
  }
  const compileTimeInitializer = sourceInitializer === undefined
    ? undefined
    : planMojoCompileTimeInitializer(sourceInitializer, context, planMojoValue, type);
  const initializer = sourceInitializer === undefined
    ? undefined
    : compileTimeInitializer ?? planMojoValue(sourceInitializer, context, type);
  if (sourceInitializer !== undefined && initializer === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_VARIABLE_INITIALIZER_NOT_PLANNED",
      "A variable initializer requires one exact sealed Mojo value plan.",
      sourceInitializer,
    );
    return undefined;
  }
  const locationStorage = context.program.queries.locationStorage(declaration);
  if (locationStorage === undefined) {
    registerMojoTypeImports(type, context);
    const defaultValue = sourceInitializer === undefined
      ? uninitializedLocalValue(type)
      : undefined;
    return Object.freeze([
      ...(initializer?.before ?? []),
      {
        kind: "variable",
        name,
        type,
        ...(compileTimeInitializer === undefined ? {} : { compileTime: true }),
        ...(initializer === undefined && defaultValue === undefined
          ? {}
          : { initializer: initializer?.value ?? defaultValue! }),
      },
    ]);
  }
  const value = initializer?.value ?? uninitializedLocalValue(type);
  if (value === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_LOCATION_STORAGE_INITIALIZER_REQUIRED",
      "A captured mutable local without an explicit initializer must have an exact undefined-capable Mojo carrier.",
      declaration,
    );
    return undefined;
  }
  const locationType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.Location",
    modulePath: Object.freeze(["tsonic_runtime"]),
    name: "Location",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type })]),
  });
  registerMojoTypeImports(locationType, context);
  return Object.freeze([...(initializer?.before ?? []), {
    kind: "variable",
    name: locationStorage.name,
    type: locationType,
    initializer: Object.freeze({
      kind: "construct",
      type: locationType,
      arguments: Object.freeze([Object.freeze({ value })]),
    }),
  }]);
}

function uninitializedLocalValue(type: MojoTargetTypeRef): MojoExpression | undefined {
  if (type.kind !== "optional" && type.kind !== "undefined") return undefined;
  return Object.freeze({
    kind: "construct",
    type,
    arguments: Object.freeze([]),
  });
}

export function planForInitializer(
  initializer: Node | undefined,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (initializer === undefined) return Object.freeze([]);
  const { ast } = context.program.source;
  if (ast.is.IsVariableDeclarationList(initializer)) {
    return planVariableDeclarationList(initializer, context);
  }
  const assignment = planMojoAssignment(initializer, context);
  if (assignment !== undefined) return Object.freeze([
    ...assignment.before,
    assignment.statement,
  ]);
  const update = planMojoUpdate(initializer, context);
  if (update !== undefined) return Object.freeze([
    ...update.before,
    update.statement,
  ]);
  const expression = planMojoValue(initializer, context);
  return expression === undefined
    ? undefined
    : Object.freeze([...expression.before, { kind: "expression", expression: expression.value }]);
}
