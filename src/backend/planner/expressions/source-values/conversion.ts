import type { MojoValueConversion } from "../../../../target-model/conversions/model.js";
import type { MojoJsValueProjection } from "../../../../target-model/conversions/js-value-graph.js";
import { mojoTargetTypeKey } from "../../../../target-model/types/key.js";
import type { MojoExpression, MojoFunctionDeclaration, MojoStatement } from "../../../target-ast/index.js";
import {
  allocateMojoSyntheticDeclarationName, allocateMojoSyntheticName, mojoTargetTypeInContext, withMojoDeferredExecution, withMojoLocalNameScope,
  mojoModuleMemberExpression,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import type { MojoNestedValueConverter } from "../conversion-support.js";
import { mojoValue, withMojoValue } from "../value-plan.js";
import type { MojoValuePlan } from "../value-plan.js";
import { planMojoSourceView } from "./adapters.js";
import type { SourceValueReader } from "./adapters.js";
import { call, construct, jsValueType, method, path, returned } from "./syntax.js";
import { sourceValueGenericArguments, sourceValueProjectionInContext } from "./generics.js";

export function convertMojoSourceValue(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "js-value-graph" }>,
  context: MojoPlanningContext,
  convert: MojoNestedValueConverter,
): MojoValuePlan | undefined {
  const definitions = new Map(conversion.graph.definitions.map((definition) =>
    [definition.id, sourceValueProjectionInContext(definition, context)]));
  const names = new Map<string, string>();
  const pending: MojoJsValueProjection[] = [];
  for (const definition of definitions.values()) {
    if (definition.kind === "scalar" || definition.kind === "provider") continue;
    const type = mojoTargetTypeInContext(definition.sourceType, context);
    const key = `${definition.kind}:${mojoTargetTypeKey(type)}`;
    let name = context.sourceValueFunctions.get(key);
    if (name === undefined) {
      name = allocateMojoSyntheticDeclarationName(context, "source_value");
      context.sourceValueFunctions.set(key, name);
      pending.push(definition);
    }
    names.set(definition.id, name);
  }
  const read: SourceValueReader = (id, expression, planning) => {
    const definition = definitions.get(id);
    if (definition === undefined) throw new Error(`Unsealed Mojo source-value graph edge '${id}'.`);
    if (definition.kind === "scalar") return convert(mojoValue(expression), definition.conversion, planning);
    if (definition.kind === "provider") return mojoValue(call(
      mojoModuleMemberExpression(planning, definition.factory.modulePath, definition.factory.name),
      [expression],
    ));
    const name = names.get(id);
    if (name === undefined) throw new Error(`Unplanned Mojo source-value graph definition '${id}'.`);
    return mojoValue(Object.freeze({ kind: "call", callee: path(name),
      genericArguments: sourceValueGenericArguments(definition), arguments: Object.freeze([{ value: expression }]),
    }));
  };
  for (const definition of pending) {
    const planning = withMojoLocalNameScope(withMojoDeferredExecution(context));
    const statements = planProjection(definition, planning, read);
    if (statements === undefined) return undefined;
    registerMojoTypeImports(definition.sourceType, context);
    registerMojoTypeImports(jsValueType, context);
    for (const parameter of definition.genericParameters) {
      for (const constraint of parameter.constraints) registerMojoTypeImports(constraint, context);
    }
    const declaration: MojoFunctionDeclaration = Object.freeze({
      kind: "function", name: names.get(definition.id)!, genericParameters: definition.genericParameters,
      parameters: Object.freeze([{ name: "source", type: definition.sourceType }]),
      resultType: jsValueType, asynchronous: false, raises: false, statements,
    });
    context.syntheticDeclarations.push(declaration);
  }
  const root = read(conversion.graph.root, plan.value, context);
  return root === undefined ? undefined : withMojoValue([...plan.before, ...root.before], root.value);
}

function planProjection(
  projection: MojoJsValueProjection,
  context: MojoPlanningContext,
  read: SourceValueReader,
): readonly MojoStatement[] | undefined {
  switch (projection.kind) {
    case "scalar":
    case "provider": throw new Error("Direct source projections must be inlined.");
    case "array":
    case "object": return planMojoSourceView(projection, context, read);
    case "polymorphic": {
      const statements: MojoStatement[] = [];
      for (const alternative of projection.alternatives) {
        const route = context.program.projectDispatch.downcastFor(projection.sourceType, alternative.sourceType);
        if (route === undefined) throw new Error("A sealed source-value projection lost its exact concrete dispatch route.");
        const name = allocateMojoSyntheticName(context, "source_view");
        const converted = read(alternative.projection, method(path(name), "value"), context);
        if (converted === undefined) return undefined;
        statements.push(Object.freeze({ kind: "variable", name,
          initializer: method(path("source"), route.name),
        }), Object.freeze({ kind: "if", condition: path(name),
          thenStatements: Object.freeze([...converted.before, returned(converted.value)]),
        }));
      }
      const base = read(projection.baseProjection, path("source"), context);
      return base === undefined ? undefined : Object.freeze([...statements, ...base.before, returned(base.value)]);
    }
    case "optional": {
      const value = read(projection.value, method(path("source"), "value"), context);
      return value === undefined ? undefined : Object.freeze([
        Object.freeze({ kind: "if", condition: path("source"),
          thenStatements: Object.freeze([...value.before, returned(value.value)]) }),
        returned(construct(jsValueType)),
      ]);
    }
    case "union": {
      let statements: readonly MojoStatement[] = Object.freeze([]);
      for (let index = projection.members.length - 1; index >= 0; index -= 1) {
        const member = projection.members[index]!;
        const expression: MojoExpression = Object.freeze({ kind: "proven-union-member", receiver: path("source"), type: member.sourceType });
        const value = read(member.projection, expression, context);
        if (value === undefined) return undefined;
        const body = Object.freeze([...value.before, returned(value.value)]);
        statements = index === projection.members.length - 1 ? body : Object.freeze([Object.freeze({
          kind: "if", condition: Object.freeze<MojoExpression>({
            kind: "method-call", receiver: path("source"), name: "isa",
            genericArguments: Object.freeze([{ kind: "type", type: member.sourceType }]), arguments: Object.freeze([]),
          }), thenStatements: body, elseStatements: statements,
        })]);
      }
      return statements;
    }
  }
}
