import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../target-ast/index.js";
import {
  allocateMojoSyntheticDeclarationName,
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
  withMojoDeferredExecution,
  withMojoErrorType,
  withMojoLocalNameScope,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { mojoNativeErrorType } from "../../../target-model/types/error-domains.js";

type JsonValueConversion = Extract<MojoValueConversion, {
  readonly kind:
    | "js-structural-object-box"
    | "js-sequence-box"
    | "js-tuple-box"
    | "js-optional-box"
    | "js-union-box"
    | "js-selected-to-json";
}>;

export function convertMojoJsonValue(
  plan: MojoValuePlan,
  conversion: JsonValueConversion,
  context: MojoPlanningContext,
  convert: (
    plan: MojoValuePlan,
    conversion: MojoValueConversion,
    context: MojoPlanningContext,
  ) => MojoValuePlan | undefined,
): MojoValuePlan | undefined {
  switch (conversion.kind) {
    case "js-structural-object-box":
      return convertStructuralObject(plan, conversion, context, convert);
    case "js-sequence-box":
      return convertSequence(plan, conversion, context, convert);
    case "js-tuple-box":
      return convertTuple(plan, conversion, context, convert);
    case "js-optional-box":
      return convertOptional(plan, conversion, context, convert);
    case "js-union-box":
      return convertUnion(plan, conversion, context, convert);
    case "js-selected-to-json":
      return convertSelectedToJson(plan, conversion, context, convert);
  }
}

function convertStructuralObject(
  plan: MojoValuePlan,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-structural-object-box" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoValuePlan | undefined {
  const stable = stabilize(plan, conversion.sourceType, "json_object", context);
  const lists = createJsonEntryLists(stable.before, context);
  for (const field of conversion.fields) {
    const value = structuralField(stable.value, field.storageIndex);
    const converted = convert(mojoValue(value), field.conversion, context);
    if (converted === undefined) return undefined;
    lists.before.push(...converted.before);
    lists.before.push(appendValue(
      lists.keys,
      Object.freeze({
        kind: "construct",
        type: jsStringType(),
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "string-literal", value: field.sourceName }),
        })]),
      }),
    ));
    lists.before.push(appendValue(lists.values, converted.value));
  }
  return withMojoValue(lists.before, Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_value_from_object_entries"),
    arguments: Object.freeze([
      Object.freeze({ value: Object.freeze({ kind: "consume", expression: lists.keys }) }),
      Object.freeze({ value: Object.freeze({ kind: "consume", expression: lists.values }) }),
    ]),
  }));
}

function convertSequence(
  plan: MojoValuePlan,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-sequence-box" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoValuePlan | undefined {
  const stable = stabilize(plan, conversion.sourceType, "json_array", context);
  const values = createJsonValueList(stable.before, context);
  const indexName = allocateMojoSyntheticName(context, "json_index");
  const optionalName = allocateMojoSyntheticName(context, "json_element");
  const boxedName = allocateMojoSyntheticName(context, "json_value");
  const index = Object.freeze({ kind: "path", path: indexName }) satisfies MojoExpression;
  const optional = Object.freeze({ kind: "path", path: optionalName }) satisfies MojoExpression;
  const boxed = Object.freeze({ kind: "path", path: boxedName }) satisfies MojoExpression;
  const converted = convert(mojoValue(Object.freeze({
    kind: "method-call",
    receiver: optional,
    name: "value",
    arguments: Object.freeze([]),
  })), conversion.elementConversion, context);
  if (converted === undefined) return undefined;
  values.before.push(Object.freeze({
    kind: "for",
    binding: indexName,
    iterable: Object.freeze({
      kind: "call",
      callee: Object.freeze({ kind: "path", path: "range" }),
      arguments: Object.freeze([Object.freeze({
        value: Object.freeze({
          kind: "call",
          callee: Object.freeze({ kind: "path", path: "len" }),
          arguments: Object.freeze([Object.freeze({ value: stable.value })]),
        }),
      })]),
    }),
    statements: Object.freeze([
      Object.freeze({
        kind: "variable",
        name: optionalName,
        type: Object.freeze({ kind: "optional", value: conversion.elementType }),
        initializer: Object.freeze({
          kind: "method-call",
          receiver: stable.value,
          name: "get",
          arguments: Object.freeze([Object.freeze({ value: index })]),
        }),
      }),
      Object.freeze({
        kind: "variable",
        name: boxedName,
        type: conversion.targetType,
        initializer: undefinedJsValue(context),
      }),
      Object.freeze({
        kind: "if",
        condition: optional,
        thenStatements: Object.freeze([
          ...converted.before,
          Object.freeze({ kind: "assignment", operator: "=", left: boxed, right: converted.value }),
        ]),
      }),
      appendValue(values.value, boxed),
    ]),
  }));
  return withMojoValue(values.before, arrayFromValues(values.value, context));
}

function convertTuple(
  plan: MojoValuePlan,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-tuple-box" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoValuePlan | undefined {
  const stable = stabilize(plan, conversion.sourceType, "json_tuple", context);
  const values = createJsonValueList(stable.before, context);
  for (const element of conversion.elements) {
    const source = Object.freeze({
      kind: "element",
      receiver: stable.value,
      index: Object.freeze({ kind: "number-literal", text: String(element.index) }),
    }) satisfies MojoExpression;
    const converted = convert(mojoValue(source), element.conversion, context);
    if (converted === undefined) return undefined;
    values.before.push(...converted.before, appendValue(values.value, converted.value));
  }
  return withMojoValue(values.before, arrayFromValues(values.value, context));
}

function convertOptional(
  plan: MojoValuePlan,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-optional-box" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoValuePlan | undefined {
  const stable = stabilize(plan, conversion.sourceType, "json_optional", context);
  const resultName = allocateMojoSyntheticName(context, "json_value");
  const result = Object.freeze({ kind: "path", path: resultName }) satisfies MojoExpression;
  const converted = convert(mojoValue(Object.freeze({
    kind: "method-call",
    receiver: stable.value,
    name: "value",
    arguments: Object.freeze([]),
  })), conversion.valueConversion, context);
  if (converted === undefined) return undefined;
  return withMojoValue(Object.freeze([
    ...stable.before,
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: conversion.targetType,
      initializer: undefinedJsValue(context),
    }),
    Object.freeze({
      kind: "if",
      condition: stable.value,
      thenStatements: Object.freeze([
        ...converted.before,
        Object.freeze({ kind: "assignment", operator: "=", left: result, right: converted.value }),
      ]),
    }),
  ]), result);
}

function convertUnion(
  plan: MojoValuePlan,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-union-box" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoValuePlan | undefined {
  const stable = stabilize(plan, conversion.sourceType, "json_union", context);
  const resultName = allocateMojoSyntheticName(context, "json_value");
  const result = Object.freeze({ kind: "path", path: resultName }) satisfies MojoExpression;
  const branches = conversion.members.map((member) => {
    const converted = convert(mojoValue(Object.freeze({
      kind: "type-element",
      receiver: stable.value,
      type: member.sourceType,
    })), member.conversion, context);
    return converted === undefined ? undefined : Object.freeze({ member, converted });
  });
  if (branches.some((branch) => branch === undefined) || branches.length === 0) return undefined;
  let statements: readonly MojoStatement[] = Object.freeze([]);
  for (let index = branches.length - 1; index >= 0; index -= 1) {
    const branch = branches[index]!;
    const body = Object.freeze([
      ...branch.converted.before,
      Object.freeze({ kind: "assignment" as const, operator: "=" as const, left: result, right: branch.converted.value }),
    ]);
    statements = index === branches.length - 1
      ? body
      : Object.freeze([Object.freeze({
          kind: "if",
          condition: Object.freeze({
            kind: "method-call",
            receiver: stable.value,
            name: "isa",
            genericArguments: Object.freeze([Object.freeze({ kind: "type", type: branch.member.sourceType })]),
            arguments: Object.freeze([]),
          }),
          thenStatements: body,
          elseStatements: statements,
        })]);
  }
  return withMojoValue(Object.freeze([
    ...stable.before,
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: conversion.targetType,
      initializer: undefinedJsValue(context),
    }),
    ...statements,
  ]), result);
}

function convertSelectedToJson(
  plan: MojoValuePlan,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-selected-to-json" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoValuePlan | undefined {
  const dispatchView = context.program.projectDispatch.viewForType(conversion.sourceType);
  const dispatch = dispatchView === undefined
    ? undefined
    : context.program.projectDispatch.callableFor(
        conversion.sourceType,
        conversion.declaration,
        Object.freeze([]),
      );
  if (dispatchView !== undefined && dispatch === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_JSON_TO_JSON_DISPATCH_NOT_SEALED",
      "A selected toJSON projection has no exact sealed project dispatch slot.",
      conversion.declaration,
    );
    return undefined;
  }
  const adapterName = allocateMojoSyntheticDeclarationName(context, "json_projection");
  const adapterType = localNamedType(context, adapterName);
  const callableType = jsonProjectionCallableType();
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(callableType, context);
  const adapter = createJsonProjectionAdapter(
    adapterName,
    adapterType,
    dispatch?.name ?? conversion.methodName,
    conversion,
    context,
    convert,
  );
  if (adapter === undefined) return undefined;
  context.syntheticDeclarations.push(adapter);
  const capturedSource: MojoExpression = conversion.sourceCopy === "explicit"
    ? Object.freeze({ kind: "copy", expression: plan.value })
    : plan.value;
  const environment = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      ["tsonic_runtime"],
      "allocate_callable_environment",
    ),
    arguments: Object.freeze([
      Object.freeze({
        value: Object.freeze({
          kind: "construct",
          type: adapterType,
          arguments: Object.freeze([Object.freeze({ value: capturedSource })]),
        }),
      }),
      Object.freeze({
        value: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: adapterName }),
          name: "destroy",
        }),
      }),
    ]),
  }) satisfies MojoExpression;
  const callable = Object.freeze({
    kind: "construct",
    type: callableType,
    arguments: Object.freeze([
      Object.freeze({ value: environment }),
      Object.freeze({
        value: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: adapterName }),
          name: "invoke",
        }),
      }),
    ]),
  }) satisfies MojoExpression;
  return withMojoValue(plan.before, Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      ["tsonic_js"],
      "js_value_from_json_projection",
    ),
    arguments: Object.freeze([Object.freeze({ value: callable })]),
  }));
}

function createJsonProjectionAdapter(
  name: string,
  adapterType: MojoTargetTypeRef,
  methodName: string,
  conversion: Extract<JsonValueConversion, { readonly kind: "js-selected-to-json" }>,
  context: MojoPlanningContext,
  convert: Parameters<typeof convertMojoJsonValue>[3],
): MojoStructDeclaration | undefined {
  const contextType = runtimeNamedType(
    "tsonic.mojo.runtime.ErasedCallableContext",
    "ErasedCallableContext",
  );
  const argumentsType = Object.freeze({
    kind: "tuple" as const,
    elements: Object.freeze([nativeStringType()]),
  });
  registerMojoTypeImports(contextType, context);
  registerMojoTypeImports(argumentsType, context);
  registerMojoTypeImports(conversion.resultType, context);
  const contextName = "context";
  const argumentsName = "arguments";
  const pointerName = "projection";
  const receiver = Object.freeze({
    kind: "member",
    receiver: Object.freeze({
      kind: "postfix-deref",
      expression: Object.freeze({ kind: "path", path: pointerName }),
    }),
    name: "source",
  }) satisfies MojoExpression;
  const methodArguments: readonly MojoCallArgument[] = conversion.passesPropertyKey
    ? Object.freeze([Object.freeze({
        value: Object.freeze({
          kind: "element",
          receiver: Object.freeze({ kind: "path", path: argumentsName }),
          index: Object.freeze({ kind: "number-literal", text: "0" }),
        }),
      })])
    : Object.freeze([]);
  const invocation = Object.freeze({
    kind: "method-call",
    receiver,
    name: methodName,
    arguments: methodArguments,
  }) satisfies MojoExpression;
  const adapterContext = withMojoErrorType(
    withMojoLocalNameScope(withMojoDeferredExecution(context)),
    mojoNativeErrorType(),
  );
  const converted = convert(mojoValue(invocation), conversion.resultConversion, adapterContext);
  if (converted === undefined) return undefined;
  const invoke: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "invoke",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: contextName, type: contextType }),
      Object.freeze({ name: argumentsName, type: argumentsType, convention: "var" }),
    ]),
    resultType: jsValueType(),
    asynchronous: false,
    raises: true,
    errorType: mojoNativeErrorType(),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([
      Object.freeze({
        kind: "variable",
        name: pointerName,
        initializer: Object.freeze({
          kind: "method-call",
          receiver: Object.freeze({ kind: "path", path: contextName }),
          name: "unsafe_bitcast",
          genericArguments: Object.freeze([Object.freeze({ kind: "type", type: adapterType })]),
          arguments: Object.freeze([]),
        }),
      }),
      ...converted.before,
      Object.freeze({ kind: "return", expression: converted.value }),
    ]),
  });
  const destroy: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "destroy",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({ name: contextName, type: contextType })]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_runtime"],
          "destroy_callable_environment",
        ),
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type: adapterType })]),
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "path", path: contextName }),
        })]),
      }),
    })]),
  });
  return Object.freeze({
    kind: "struct",
    name,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze([Object.freeze({
      name: "source",
      type: conversion.sourceType,
      compileTime: false,
    })]),
    methods: Object.freeze([invoke, destroy]),
    decorators: mojoFieldwiseInitDecorators,
  });
}

function stabilize(
  plan: MojoValuePlan,
  type: MojoTargetTypeRef,
  role: string,
  context: MojoPlanningContext,
): { readonly before: MojoStatement[]; readonly value: MojoExpression } {
  registerMojoTypeImports(type, context);
  const name = allocateMojoSyntheticName(context, role);
  return {
    before: [...plan.before, Object.freeze({ kind: "variable", name, type, initializer: plan.value })],
    value: Object.freeze({ kind: "path", path: name }),
  };
}

function createJsonEntryLists(
  before: MojoStatement[],
  context: MojoPlanningContext,
): { readonly before: MojoStatement[]; readonly keys: MojoExpression; readonly values: MojoExpression } {
  const keyName = allocateMojoSyntheticName(context, "json_keys");
  const valueName = allocateMojoSyntheticName(context, "json_values");
  const keys = Object.freeze({ kind: "path", path: keyName }) satisfies MojoExpression;
  const values = Object.freeze({ kind: "path", path: valueName }) satisfies MojoExpression;
  const keyList = Object.freeze({ kind: "list" as const, element: jsStringType() });
  const valueList = Object.freeze({ kind: "list" as const, element: jsValueType() });
  registerMojoTypeImports(keyList, context);
  registerMojoTypeImports(valueList, context);
  before.push(
    Object.freeze({ kind: "variable", name: keyName, type: keyList, initializer: emptyList(keyList) }),
    Object.freeze({ kind: "variable", name: valueName, type: valueList, initializer: emptyList(valueList) }),
  );
  return { before, keys, values };
}

function createJsonValueList(
  before: MojoStatement[],
  context: MojoPlanningContext,
): { readonly before: MojoStatement[]; readonly value: MojoExpression } {
  const name = allocateMojoSyntheticName(context, "json_values");
  const type = Object.freeze({ kind: "list" as const, element: jsValueType() });
  registerMojoTypeImports(type, context);
  const value = Object.freeze({ kind: "path", path: name }) satisfies MojoExpression;
  before.push(Object.freeze({ kind: "variable", name, type, initializer: emptyList(type) }));
  return { before, value };
}

function emptyList(type: MojoTargetTypeRef): MojoExpression {
  return Object.freeze({ kind: "construct", type, arguments: Object.freeze([]) });
}

function appendValue(receiver: MojoExpression, value: MojoExpression): MojoStatement {
  return Object.freeze({
    kind: "expression",
    expression: Object.freeze({
      kind: "method-call",
      receiver,
      name: "append",
      arguments: Object.freeze([Object.freeze({ value })]),
    }),
  });
}

function arrayFromValues(values: MojoExpression, context: MojoPlanningContext): MojoExpression {
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_value_from_array_values"),
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({ kind: "consume", expression: values }),
    })]),
  });
}

function undefinedJsValue(context: MojoPlanningContext): MojoExpression {
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_value_from_undefined"),
    arguments: Object.freeze([]),
  });
}

function structuralField(receiver: MojoExpression, storageIndex: number): MojoExpression {
  return Object.freeze({
    kind: "element",
    receiver: Object.freeze({
      kind: "postfix-deref",
      expression: Object.freeze({ kind: "member", receiver, name: "_state" }),
    }),
    index: Object.freeze({ kind: "number-literal", text: String(storageIndex) }),
  });
}

function jsStringType(): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.js.JsString",
    modulePath: Object.freeze(["tsonic_js"]),
    name: "JsString",
  });
}

function jsValueType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "dynamic", domain: "js" });
}

function nativeStringType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "native-string" });
}

function jsonProjectionCallableType(): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> {
  return Object.freeze({
    kind: "callable",
    parameters: Object.freeze([Object.freeze({
      convention: "var",
      passing: "consume",
      type: nativeStringType(),
    })]),
    result: jsValueType(),
    raises: true,
    errorType: mojoNativeErrorType(),
  });
}

function localNamedType(context: MojoPlanningContext, name: string): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: `tsonic.mojo.generated.${context.module.modulePath.join(".")}.${name}`,
    modulePath: context.module.modulePath,
    name,
  });
}

function runtimeNamedType(id: string, name: string): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id,
    modulePath: Object.freeze(["tsonic_runtime"]),
    name,
  });
}
