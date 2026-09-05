import type {
  MojoAnalyzedInterface,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import { mojoFieldwiseInitDecorators } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import {
  mojoReferenceIdentityEqualityMethod,
} from "./reference-wrapper.js";
import { mojoStateStorageType } from "./state-storage.js";
import { consumeMojoValue } from "../expressions/value-plan.js";
import {
  mojoConstructionFactory,
  mojoErasedStateWrapperInitializer,
} from "./construction-factories.js";

export function planMojoInterface(
  interface_: MojoAnalyzedInterface,
  context: MojoPlanningContext,
): readonly MojoDeclaration[] {
  const genericParameters = Object.freeze(interface_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    name: parameter.name,
    identity: parameter.identity,
    position: "positional-or-keyword" as const,
    variadic: false,
    constraints: parameter.constraints,
  })));
  const genericArguments = interface_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    type: Object.freeze({
      kind: "type-parameter" as const,
      name: parameter.name,
      identity: parameter.identity,
    }),
  }));
  const stateType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: `${interface_.targetType.kind === "target-named" ? interface_.targetType.id : interface_.name}:state`,
    modulePath: Object.freeze([]),
    name: interface_.stateName,
    ...(genericArguments.length === 0 ? {} : { genericArguments: Object.freeze(genericArguments) }),
  });
  const arcType = mojoStateStorageType(stateType, interface_.stateStorage);
  registerMojoTypeImports(arcType, context);
  for (const field of interface_.fields) registerMojoTypeImports(field.type, context);
  const indexStorage = interface_.indexSignatures.map((indexSignature) => Object.freeze({
    indexSignature,
    type: Object.freeze({
      kind: "dictionary" as const,
      key: indexSignature.keyType,
      value: indexSignature.valueType,
    }),
  }));
  for (const storage of indexStorage) registerMojoTypeImports(storage.type, context);
  const state: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: interface_.stateName,
    genericParameters,
    conformances: Object.freeze([]),
    fields: Object.freeze([
      ...interface_.fields.map((field) => Object.freeze({
        name: field.name,
        type: field.type,
        compileTime: false,
      })),
      ...indexStorage.map(({ indexSignature, type }) => Object.freeze({
        name: indexSignature.storageName,
        type,
        compileTime: false,
      })),
    ]),
    methods: Object.freeze([]),
    decorators: mojoFieldwiseInitDecorators,
  });
  const stateConstruction = Object.freeze({
    kind: "construct" as const,
    type: stateType,
    arguments: Object.freeze([
      ...interface_.fields.map((field) => Object.freeze({
        value: consumeMojoValue(
          Object.freeze({ kind: "path" as const, path: field.name }),
          field.type,
          context.program.lifecycle,
        ),
      })),
      ...indexStorage.map(({ indexSignature, type }) => Object.freeze({
        value: consumeMojoValue(
          Object.freeze({ kind: "path" as const, path: indexSignature.storageName }),
          type,
          context.program.lifecycle,
        ),
      })),
    ]),
  });
  const initialize: MojoStatement = Object.freeze({
    kind: "assignment",
    operator: "=",
    left: Object.freeze({
      kind: "member",
      receiver: Object.freeze({ kind: "path", path: "self" }),
      name: "_state",
    }),
    right: Object.freeze({
      kind: "construct",
      type: arcType,
      arguments: Object.freeze([{ value: stateConstruction }]),
    }),
  });
  const constructor: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      ...interface_.fields.map((field) => Object.freeze({
        name: field.name,
        type: field.type,
        convention: "var" as const,
      })),
      ...indexStorage.map(({ indexSignature, type }) => Object.freeze({
        name: indexSignature.storageName,
        type,
        convention: "var" as const,
      })),
    ]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    self: "out self",
    statements: Object.freeze([initialize]),
  });
  const wrapper: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: interface_.name,
    genericParameters,
    conformances: Object.freeze([Object.freeze({
      kind: "target-named",
      id: "mojo.builtin.ImplicitlyCopyable",
      modulePath: Object.freeze([]),
      name: "ImplicitlyCopyable",
    }), Object.freeze({
      kind: "target-named",
      id: "mojo.builtin.Equatable",
      modulePath: Object.freeze([]),
      name: "Equatable",
    })]),
    fields: Object.freeze([Object.freeze({
      name: "_state",
      type: arcType,
      compileTime: false,
    })]),
    methods: Object.freeze([
      interface_.stateStorage === "direct"
        ? constructor
        : mojoErasedStateWrapperInitializer(arcType),
      mojoReferenceIdentityEqualityMethod(interface_.targetType),
    ]),
  });
  if (interface_.stateStorage === "direct") return Object.freeze([state, wrapper]);
  const factory = mojoConstructionFactory({
    name: interface_.constructorFactoryName,
    genericParameters,
    parameters: constructor.parameters,
    resultType: interface_.targetType,
    raises: false,
    statements: Object.freeze([]),
    result: Object.freeze({
      kind: "construct",
      type: interface_.targetType,
      arguments: Object.freeze([Object.freeze({
        value: Object.freeze({
          kind: "construct",
          type: arcType,
          arguments: Object.freeze([Object.freeze({ value: stateConstruction })]),
        }),
      })]),
    }),
  });
  return Object.freeze([state, wrapper, factory]);
}
