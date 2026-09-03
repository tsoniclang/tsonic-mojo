import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
} from "../../../../analysis/program/model.js";
import type { MojoStructDeclaration } from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import {
  planMojoProjectFunction,
  planMojoGenericParameters,
} from "../../declarations/project.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { planMojoConcreteDispatchMethods } from "./adapters.js";
import {
  mojoProjectViewFields,
  planMojoProjectViewForwarders,
  planMojoProjectViewInitializer,
} from "./forwarders.js";
import {
  mojoProjectErrorWritableMethod,
  mojoProjectIdentityEqualityMethod,
} from "./identity.js";
import { planMojoProjectImplementation } from "./implementations.js";
import {
  planMojoPolymorphicClassConstructor,
  planMojoPolymorphicClassState,
} from "./state.js";

export function planMojoPolymorphicProjectClass(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] | undefined {
  const view = context.program.projectDispatch.viewForType(class_.targetType);
  const concrete = context.program.projectDispatch.concreteFor(class_.definition);
  if (view === undefined || concrete === undefined) return undefined;
  const state = planMojoPolymorphicClassState(class_, context);
  const constructor = planMojoPolymorphicClassConstructor(class_, concrete, context);
  const forwarders = planMojoProjectViewForwarders(view, context);
  const adapters = planMojoConcreteDispatchMethods(concrete, context);
  if (state === undefined || constructor === undefined || forwarders === undefined ||
    adapters === undefined) return undefined;
  const methods = [
    planMojoProjectViewInitializer(view),
    constructor,
    mojoProjectIdentityEqualityMethod(class_.targetType),
    ...forwarders,
  ];
  for (const method of class_.methods) {
    if (method.static === true) {
      const planned = planMojoProjectFunction(method, context);
      if (planned === undefined) return undefined;
      methods.push(Object.freeze({ ...planned, decorators: mojoStaticMethodDecorators }));
      continue;
    }
    const name = context.program.projectDispatch.implementationName(method.declaration);
    const planned = name === undefined
      ? undefined
      : planMojoProjectImplementation(method, name, context);
    if (planned === undefined) return undefined;
    methods.push(planned);
  }
  for (const accessor of class_.accessors) {
    if (accessor.static === true) {
      const planned = planMojoProjectFunction(accessor, context);
      if (planned === undefined) return undefined;
      methods.push(Object.freeze({ ...planned, decorators: mojoStaticMethodDecorators }));
      continue;
    }
    const name = context.program.projectDispatch.implementationName(accessor.declaration);
    const planned = name === undefined
      ? undefined
      : planMojoProjectImplementation(accessor, name, context);
    if (planned === undefined) return undefined;
    methods.push(planned);
  }
  methods.push(...adapters);
  if (class_.errorRole === "typed") {
    const message = view.fields.find((field) => field.property.sourceName === "message")?.read?.name;
    methods.push(mojoProjectErrorWritableMethod(class_.name, message));
  }
  const wrapper: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.name,
    genericParameters: planMojoGenericParameters(class_),
    conformances: Object.freeze([
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.ImplicitlyCopyable",
        modulePath: Object.freeze([]),
        name: "ImplicitlyCopyable",
      }),
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.Equatable",
        modulePath: Object.freeze([]),
        name: "Equatable",
      }),
      ...(class_.errorRole === "typed"
        ? [Object.freeze({
            kind: "target-named" as const,
            id: "mojo.builtin.Writable",
            modulePath: Object.freeze([]),
            name: "Writable",
          })]
        : []),
    ]),
    fields: mojoProjectViewFields(view, context),
    methods: Object.freeze(methods),
  });
  return Object.freeze([state, wrapper]);
}

export function planMojoPolymorphicInterface(
  interface_: MojoAnalyzedInterface,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] | undefined {
  const view = context.program.projectDispatch.viewForType(interface_.targetType);
  if (view === undefined) return undefined;
  const forwarders = planMojoProjectViewForwarders(view, context);
  if (forwarders === undefined) return undefined;
  return Object.freeze([Object.freeze({
    kind: "struct",
    name: interface_.name,
    genericParameters: planMojoGenericParameters(interface_),
    conformances: Object.freeze([
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.ImplicitlyCopyable",
        modulePath: Object.freeze([]),
        name: "ImplicitlyCopyable",
      }),
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.Equatable",
        modulePath: Object.freeze([]),
        name: "Equatable",
      }),
    ]),
    fields: mojoProjectViewFields(view, context),
    methods: Object.freeze([
      planMojoProjectViewInitializer(view),
      mojoProjectIdentityEqualityMethod(interface_.targetType),
      ...forwarders,
    ]),
  })]);
}
