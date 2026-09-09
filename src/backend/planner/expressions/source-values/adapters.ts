import type { MojoJsValueProjection } from "../../../../target-model/conversions/js-value-graph.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import { mojoNativeErrorType } from "../../../../target-model/types/error-domains.js";
import { mojoFieldwiseInitDecorators, mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import type { MojoExpression, MojoFunctionDeclaration, MojoStatement, MojoStructDeclaration } from "../../../target-ast/index.js";
import {
  allocateMojoSyntheticDeclarationName, appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression, withMojoDeferredExecution, withMojoErrorType, withMojoLocalNameScope,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import { mojoProjectStateValue } from "../../declarations/state-storage.js";
import { adaptMojoValueErrorDomain } from "../error-domains.js";
import { mojoValue } from "../value-plan.js";
import type { MojoValuePlan } from "../value-plan.js";
import {
  boolType, call, callableType, construct, element, erasedContextType, intType,
  jsStringType, jsValueType, member, method, named, number, path, returned, stringType, tupleType,
} from "./syntax.js";
import { sourceValueGenericArguments } from "./generics.js";

export type SourceValueReader = (projection: string, expression: MojoExpression, context: MojoPlanningContext) => MojoValuePlan | undefined;
type ReferenceProjection = Extract<MojoJsValueProjection, { readonly kind: "object" | "array" }>;

export function planMojoSourceView(
  projection: ReferenceProjection,
  context: MojoPlanningContext,
  read: SourceValueReader,
): readonly MojoStatement[] | undefined {
  const name = allocateMojoSyntheticDeclarationName(context, "SourceValueView");
  const adapterType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named", id: `tsonic.mojo.generated.${context.module.modulePath.join(".")}.${name}`,
    modulePath: context.module.modulePath, name, genericArguments: sourceValueGenericArguments(projection),
  });
  const adapterExpression: MojoExpression = Object.freeze({ kind: "type-value", type: adapterType });
  const adapterContext = withMojoLocalNameScope(withMojoDeferredExecution(context));
  const restored: MojoExpression = Object.freeze({
    kind: "postfix-deref", expression: Object.freeze({
      kind: "method-call", receiver: path("context"), name: "unsafe_bitcast",
      genericArguments: Object.freeze([{ kind: "type", type: adapterType }]), arguments: Object.freeze([]),
    }),
  });
  const source = member(restored, "source");
  const index = element(path("arguments"), 0);
  const methods: MojoFunctionDeclaration[] = [];
  const callbacks: { readonly name: string; readonly type: MojoTargetTypeRef }[] = [];
  const add = (
    name: string, parameters: readonly MojoTargetTypeRef[], result: MojoTargetTypeRef,
    statements: readonly MojoStatement[], raises = false,
  ): void => {
    const type = callableType(parameters, result, raises);
    const argumentsType = tupleType(parameters);
    registerMojoTypeImports(type, context);
    registerMojoTypeImports(argumentsType, context);
    callbacks.push(Object.freeze({ name, type }));
    methods.push(Object.freeze({
      kind: "function", name, genericParameters: Object.freeze([]), asynchronous: false,
      parameters: Object.freeze([{ name: "context", type: erasedContextType },
        { name: "arguments", type: argumentsType, convention: "var" }]),
      resultType: result, raises, ...(raises ? { errorType: mojoNativeErrorType() } : {}),
      decorators: mojoStaticMethodDecorators, statements,
    }));
  };
  if (projection.kind === "array") {
    add("length", [], intType, [returned(call(path("len"), [source]))]);
    add("has", [intType], boolType, [returned(method(source, "has", [index]))]);
    const converted = read(projection.element, method(method(source, "get", [index]), "value"), adapterContext);
    if (converted === undefined) return undefined;
    add("value", [intType], jsValueType, [...converted.before, returned(converted.value)]);
  } else {
    add("length", [], intType, [returned(number(projection.fields.length))]);
    const keyBranches: { readonly index: number; readonly statements: readonly MojoStatement[] }[] = [];
    const valueBranches: { readonly index: number; readonly statements: readonly MojoStatement[] }[] = [];
    for (const [fieldIndex, field] of projection.fields.entries()) {
      keyBranches.push({ index: fieldIndex, statements: [returned(construct(jsStringType, [Object.freeze({
        kind: "string-literal", value: field.sourceName,
      })]))] });
      let fieldValue: MojoExpression | undefined;
      if (field.access.kind === "structural") {
        fieldValue = element(Object.freeze({ kind: "postfix-deref", expression: member(source, "_state") }), field.access.index);
      } else {
        let state: MojoExpression | undefined;
        if (projection.identity === "project-polymorphic") {
          const storage = context.program.queries.projectState(projection.sourceType);
          if (storage !== undefined) {
            registerMojoTypeImports(storage.stateType, context);
            state = Object.freeze({ kind: "method-call", receiver: member(source, "_object"), name: "state",
              genericArguments: Object.freeze([{ kind: "type", type: storage.stateType }]), arguments: Object.freeze([]),
            });
          }
        } else {
          state = mojoProjectStateValue(source, projection.sourceType, context);
        }
        if (state !== undefined) fieldValue = field.access.path.reduce((receiver, name) => member(receiver, name), state);
      }
      if (fieldValue === undefined) return undefined;
      const converted = read(field.projection, fieldValue, adapterContext);
      if (converted === undefined) return undefined;
      valueBranches.push({ index: fieldIndex, statements: [...converted.before, returned(converted.value)] });
    }
    add("key", [intType], jsStringType, indexedBranches(keyBranches, construct(jsStringType)));
    add("value", [intType], jsValueType, indexedBranches(valueBranches, construct(jsValueType)));
    if (projection.toJson !== undefined) {
      const selected = projection.toJson;
      const implementation = context.program.queries.callableImplementation(selected.declaration);
      if (implementation === undefined) {
        appendMojoPlanningDiagnostic(context, "MOJO_SOURCE_VALUE_TO_JSON_NOT_SEALED",
          "The selected source-value toJSON method has no sealed implementation.", selected.declaration);
        return undefined;
      }
      const raisingContext = withMojoErrorType(adapterContext, mojoNativeErrorType());
      const invocation = adaptMojoValueErrorDomain(
        mojoValue(method(source, selected.name, selected.passesPropertyKey ? [index] : [])),
        selected.resultType, implementation.raises ? implementation.errorType : undefined,
        mojoNativeErrorType(), selected.declaration, raisingContext,
      );
      if (invocation === undefined) return undefined;
      const converted = read(selected.resultProjection, invocation.value, raisingContext);
      if (converted === undefined) return undefined;
      add("to_json", [stringType], jsValueType, [...invocation.before, ...converted.before, returned(converted.value)], true);
    }
  }
  registerMojoTypeImports(erasedContextType, context);
  registerMojoTypeImports(projection.sourceType, context);
  methods.push(Object.freeze({
    kind: "function", name: "destroy", genericParameters: Object.freeze([]), asynchronous: false,
    parameters: Object.freeze([{ name: "context", type: erasedContextType }]),
    resultType: Object.freeze({ kind: "unit" }), raises: false, decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({ kind: "expression", expression: Object.freeze({
      kind: "call", callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "destroy_callable_environment"),
      genericArguments: Object.freeze([{ kind: "type", type: adapterType }]),
      arguments: Object.freeze([{ value: path("context") }]),
    }) })]),
  }));
  const declaration: MojoStructDeclaration = Object.freeze({
    kind: "struct", name, genericParameters: projection.genericParameters, conformances: Object.freeze([]),
    fields: Object.freeze([{ name: "source", type: projection.sourceType, compileTime: false }]),
    methods: Object.freeze(methods), decorators: mojoFieldwiseInitDecorators,
  });
  context.syntheticDeclarations.push(declaration);
  const captured: MojoExpression = projection.sourceCopy === "explicit"
    ? Object.freeze({ kind: "copy", expression: path("source") }) : path("source");
  const environment = call(mojoModuleMemberExpression(context, ["tsonic_runtime"], "allocate_callable_environment"), [
    construct(adapterType, [captured]), member(adapterExpression, "destroy"),
  ]);
  let identity: MojoExpression;
  if (projection.kind === "object" && projection.identity === "project-direct") {
    const identityType = named("tsonic_runtime", "tsonic.mojo.runtime.WeakReferenceIdentity", "WeakReferenceIdentity");
    registerMojoTypeImports(identityType, context);
    identity = construct(identityType, [member(path("source"), "_state")]);
  } else {
    const receiver = projection.kind !== "object" ? path("source") :
      projection.identity === "project-polymorphic" ? member(path("source"), "_object") :
        projection.identity === "project-erased" ? member(path("source"), "_state") : path("source");
    identity = method(receiver, "weak_identity");
  }
  return Object.freeze([
    Object.freeze({ kind: "variable", name: "environment", initializer: environment }),
    returned(call(mojoModuleMemberExpression(context, ["tsonic_js"], projection.kind === "array"
      ? "js_value_from_source_array" : "js_value_from_source_object"), [
      identity, ...callbacks.map((callback) => construct(callback.type, [path("environment"), member(adapterExpression, callback.name)])),
    ])),
  ]);
}

function indexedBranches(
  branches: readonly { readonly index: number; readonly statements: readonly MojoStatement[] }[],
  empty: MojoExpression,
): readonly MojoStatement[] {
  if (branches.length === 0) return Object.freeze([returned(empty)]);
  let body = branches[branches.length - 1]!.statements;
  for (let index = branches.length - 2; index >= 0; index -= 1) {
    const branch = branches[index]!;
    body = Object.freeze([Object.freeze({
      kind: "if", condition: Object.freeze({
        kind: "binary", operator: "==", left: element(path("arguments"), 0), right: number(branch.index),
      }), thenStatements: branch.statements, elseStatements: body,
    })]);
  }
  return body;
}
