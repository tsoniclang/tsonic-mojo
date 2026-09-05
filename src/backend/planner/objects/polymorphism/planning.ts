import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
} from "../../../../analysis/program/model.js";
import type { MojoDeclaration, MojoStructDeclaration } from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import {
  planMojoProjectFunctionVariants,
} from "../../declarations/project.js";
import { planMojoGenericParameters } from "../../declarations/generic-parameters.js";
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
import { planMojoProjectImplementationVariants } from "./implementations.js";
import {
  planMojoPolymorphicClassConstructors,
  planMojoPolymorphicClassState,
} from "./state.js";
import { planMojoMemberImplementationAdapter } from "../../callables/implementation-adapters.js";

export function planMojoPolymorphicProjectClass(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): readonly MojoDeclaration[] | undefined {
  const view = context.program.projectDispatch.viewForType(class_.targetType);
  const concrete = context.program.projectDispatch.concreteFor(class_.definition);
  if (view === undefined || concrete === undefined) return undefined;
  const state = planMojoPolymorphicClassState(class_, context);
  const constructors = planMojoPolymorphicClassConstructors(class_, concrete, context);
  const forwarders = planMojoProjectViewForwarders(view, context);
  const adapters = planMojoConcreteDispatchMethods(concrete, context);
  const implementationAdapters = context.program.callableImplementationAdapters
    .filter((adapter) => adapter.owner?.definition === class_.definition &&
      (adapter.kind === "instance-method-overload" ||
        adapter.kind === "static-method-overload"))
    .map((adapter) => planMojoMemberImplementationAdapter(adapter, context));
  if (state === undefined || constructors === undefined || forwarders === undefined ||
    implementationAdapters.some((adapter) => adapter === undefined) ||
    adapters === undefined) return undefined;
  const methods = [
    planMojoProjectViewInitializer(view),
    ...constructors.initializers,
    ...(implementationAdapters as import("../../../target-ast/index.js").MojoFunctionDeclaration[]),
    mojoProjectIdentityEqualityMethod(class_.targetType),
    ...forwarders,
  ];
  for (const method of class_.methods) {
    if (method.static === true) {
      const planned = planMojoProjectFunctionVariants(method, context);
      if (planned === undefined) return undefined;
      methods.push(...planned.map((declaration) => Object.freeze({
        ...declaration,
        decorators: mojoStaticMethodDecorators,
      })));
      continue;
    }
    const planned = planMojoProjectImplementationVariants(method, context);
    if (planned === undefined) return undefined;
    methods.push(...planned);
  }
  for (const accessor of class_.accessors) {
    if (accessor.static === true) {
      const planned = planMojoProjectFunctionVariants(accessor, context);
      if (planned === undefined) return undefined;
      methods.push(...planned.map((declaration) => Object.freeze({
        ...declaration,
        decorators: mojoStaticMethodDecorators,
      })));
      continue;
    }
    const planned = planMojoProjectImplementationVariants(accessor, context);
    if (planned === undefined) return undefined;
    methods.push(...planned);
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
  return Object.freeze([state, wrapper, ...constructors.factories]);
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
