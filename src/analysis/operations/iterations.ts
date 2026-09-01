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
  if (source.iterationKind === "for-await-of") {
    return unsupported(
      "MOJO_ASYNC_ITERATION_NATIVE_LIMIT",
      "The active Mojo compiler exposes no native asynchronous iteration statement contract.",
    );
  }
  const bindingDeclaration = selectedBindingDeclaration(input.statement, input.ast);
  if (bindingDeclaration === undefined) {
    return unsupported(
      "MOJO_ITERATION_BINDING_UNSUPPORTED",
      "Iteration requires one exact variable declaration with an identifier binding.",
    );
  }
  const bindingName = input.bindingNames.get(bindingDeclaration);
  const bindingType = input.bindingTypes.get(bindingDeclaration);
  const iterableType = input.resolveType(source.sourceIterableType);
  const sourceElementType = input.resolveType(source.sourceElementType);
  if (bindingName === undefined || bindingType === undefined || iterableType === undefined || sourceElementType === undefined) {
    return unsupported(
      "MOJO_ITERATION_CARRIER_NOT_CLOSED",
      "Iteration binding, iterable, or selected source element lacks one exact Mojo carrier.",
    );
  }
  const target = targetIterationContract(source.iterationKind, iterableType);
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
      kind: source.iterationKind,
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
): { readonly target: "native-values" | "dictionary-keys"; readonly elementType: MojoTargetTypeRef } | undefined {
  if (kind === "for-of") {
    if (iterable.kind === "list" || iterable.kind === "fixed-array") {
      return { target: "native-values", elementType: iterable.element };
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
