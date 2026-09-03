import type {
  AstReader,
  Node,
  ResolvedSourceIterationInfo,
  Type,
} from "@tsonic/tsts";
import {
  ForInOrOfStatement_Initializer,
  VariableDeclarationList_Declarations,
} from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoIterationSelection } from "../program/model.js";

export type MojoIterationAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoIterationSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoIterationAnalysisInput {
  readonly ast: AstReader;
  readonly statement: Node;
  readonly iterable: Node;
  readonly source: ResolvedSourceIterationInfo;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
}

export function analyzeMojoIteration(input: MojoIterationAnalysisInput): MojoIterationAnalysis {
  const { source } = input;
  if (source.iterationKind === "for-await-of" && !isSynchronousAsyncAdaptation(source.mechanism)) {
    return unsupported(
      "MOJO_ASYNC_ITERATOR_PROTOCOL_NATIVE_LIMIT",
      "The active Mojo compiler exposes no native asynchronous iterator protocol; only checker-selected synchronous iteration adapted to for-await is representable without a target-owned suspension machine.",
    );
  }
  const bindingDeclaration = selectedBindingDeclaration(input.statement, input.ast);
  if (bindingDeclaration === undefined) {
    return unsupported(
      "MOJO_ITERATION_BINDING_UNSUPPORTED",
      "Iteration requires one exact variable declaration with an identifier binding.",
    );
  }
  const bindingNameNode = input.ast.name(bindingDeclaration);
  const bindingName = input.bindingNames.get(bindingDeclaration) ??
    (bindingNameNode === undefined ? undefined : input.bindingNames.get(bindingNameNode));
  const bindingType = input.bindingTypes.get(bindingDeclaration);
  const iterableType = input.resolveType(source.sourceIterableType);
  const sourceElementType = input.resolveType(source.sourceElementType);
  if (bindingName === undefined || bindingType === undefined || iterableType === undefined || sourceElementType === undefined) {
    const missing = [
      ...(bindingName === undefined ? ["binding name"] : []),
      ...(bindingType === undefined ? ["binding carrier"] : []),
      ...(iterableType === undefined ? ["source iterable carrier"] : []),
      ...(sourceElementType === undefined ? ["source element carrier"] : []),
    ];
    return unsupported(
      "MOJO_ITERATION_CARRIER_NOT_CLOSED",
      `Iteration lacks an exact ${missing.join(", ")}.`,
    );
  }
  const target = targetIterationContract(
    source.iterationKind === "for-await-of" ? "for-of" : source.iterationKind,
    iterableType,
  );
  if (target === undefined) {
    return unsupported(
      "MOJO_ITERATION_TARGET_UNSUPPORTED",
      "The selected iterable has no exact native Mojo iteration contract.",
    );
  }
  if (!mojoTargetTypeEquals(target.elementType, sourceElementType)) {
    return unsupported(
      "MOJO_ITERATION_SOURCE_TARGET_CONFLICT",
      "The checker-selected source element and native Mojo iterator element carriers differ.",
    );
  }
  if (!mojoTargetTypeEquals(sourceElementType, bindingType)) {
    return unsupported(
      "MOJO_ITERATION_BINDING_CONVERSION_UNSUPPORTED",
      "Iteration binding requires a conversion that cannot be represented at the native loop boundary.",
    );
  }
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: source.iterationKind === "for-await-of" ? "for-of" : source.iterationKind,
      statement: input.statement,
      iterable: input.iterable,
      bindingDeclaration,
      bindingName,
      iterableType,
      elementType: target.elementType,
      target: target.target,
    }),
  };
}

function isSynchronousAsyncAdaptation(
  mechanism: Extract<ResolvedSourceIterationInfo, { readonly iterationKind: "for-await-of" }>[
    "mechanism"
  ],
): boolean {
  if (mechanism.kind === "union") {
    return mechanism.alternatives.every(isSynchronousAsyncAdaptation);
  }
  return mechanism.kind === "synchronous-iterator-adapted-to-async" ||
    mechanism.kind === "array-like-index-adapted-to-async" ||
    mechanism.kind === "string-code-unit-index-adapted-to-async";
}

function selectedBindingDeclaration(statement: Node, ast: AstReader): Node | undefined {
  const initializer = ForInOrOfStatement_Initializer(ast, statement);
  if (initializer === undefined || !ast.is.IsVariableDeclarationList(initializer)) return undefined;
  const declarations = VariableDeclarationList_Declarations(ast, initializer) ?? [];
  if (declarations.length !== 1 || declarations[0] === undefined) return undefined;
  const declaration = declarations[0];
  const name = ast.name(declaration);
  return name !== undefined && ast.is.IsIdentifier(name) ? declaration : undefined;
}

function targetIterationContract(
  kind: "for-of" | "for-in",
  iterable: MojoTargetTypeRef,
): {
  readonly target: MojoIterationSelection["target"];
  readonly elementType: MojoTargetTypeRef;
} | undefined {
  if (kind === "for-of") {
    if (iterable.kind === "list" || iterable.kind === "fixed-array") {
      return { target: "native-values", elementType: iterable.element };
    }
    if (iterable.kind === "target-named" &&
      iterable.id === "tsonic.mojo.js.JsArray" &&
      iterable.genericArguments?.length === 1 &&
      iterable.genericArguments[0]?.kind === "type") {
      return {
        target: "js-array-values",
        elementType: iterable.genericArguments[0].type,
      };
    }
    if (iterable.kind === "target-named" &&
      iterable.id === "tsonic.mojo.js.JsString") {
      return { target: "js-string-values", elementType: iterable };
    }
    if (iterable.kind === "target-named" &&
      iterable.id === "tsonic.mojo.js.JsMap" &&
      iterable.genericArguments?.length === 2) {
      const key = iterable.genericArguments[0];
      const value = iterable.genericArguments[1];
      if (key?.kind === "type" && value?.kind === "type") {
        return {
          target: "js-map-entries",
          elementType: Object.freeze({
            kind: "tuple",
            elements: Object.freeze([key.type, value.type]),
          }),
        };
      }
    }
    if (iterable.kind === "target-named" &&
      iterable.id === "tsonic.mojo.js.JsSet" &&
      iterable.genericArguments?.length === 1 &&
      iterable.genericArguments[0]?.kind === "type") {
      return {
        target: "js-set-values",
        elementType: iterable.genericArguments[0].type,
      };
    }
    return undefined;
  }
  return iterable.kind === "dictionary"
    ? { target: "dictionary-keys", elementType: iterable.key }
    : undefined;
}

function unsupported(code: string, reason: string): MojoIterationAnalysis {
  return { kind: "unsupported", code, reason };
}
