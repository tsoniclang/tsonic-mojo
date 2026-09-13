import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoAnalyzedClassOwner, MojoCallableCapture, MojoCallableExpressionSelection, MojoRecursiveCallableBinding } from "../program/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";
import { captureEligibleDeclaration, isNestedCallable, nodeIsWithin } from "./expression-syntax.js";

export interface MojoCallableCaptureInput {
  readonly expression: Node;
  readonly roots: readonly Node[];
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly source: TargetSourceProgram;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly ensureLocationStorage: (declaration: Node, bindingName: string) => string;
  readonly moduleBindingByDeclaration: WeakMap<Node, unknown>;
  readonly diagnostics: TargetDiagnostic[];
  readonly recursiveDeclaration?: Node;
  readonly captureSelf?: boolean;
  readonly callableSelections: WeakMap<Node, MojoCallableExpressionSelection>;
}

export function collectMojoCallableCaptures(
  input: MojoCallableCaptureInput,
): {
  readonly captures: readonly MojoCallableCapture[];
  readonly recursiveBinding?: MojoRecursiveCallableBinding;
} | undefined {
  const { ast } = input.source;
  const captures = new Map<Node, MojoCallableCapture>();
  let recursiveBinding: MojoRecursiveCallableBinding | undefined;
  let valid = true;
  let capturesSelf = false;
  for (const root of input.roots) {
    walkSourceTree(root, ast, (node): void => {
      if (!valid) return;
      const nested = input.callableSelections.get(node);
      if (nested !== undefined && node !== input.expression) {
        for (const capture of nested.captures) {
          if (capture.declaration === nested.expression) {
            if (input.captureSelf !== false) capturesSelf = true;
          } else if (capture.declaration === input.recursiveDeclaration && capture.type.kind === "callable") {
            recursiveBinding = Object.freeze({ declaration: capture.declaration, name: capture.name, type: capture.type });
          } else if (!nodeIsWithin(capture.declaration, input.expression, ast)) {
            const existing = captures.get(capture.declaration);
            if (existing !== undefined && existing.storage !== capture.storage) {
              throw new Error("Nested callable captures disagree on exact binding storage.");
            }
            captures.set(capture.declaration, capture);
          }
        }
        return;
      }
      if (ast.kindName(node) === "KindThisKeyword") {
        if (input.captureSelf === false && input.owner !== undefined) return;
        if (ast.is.IsArrowFunction(input.expression) && input.owner !== undefined) {
          capturesSelf = true;
          return;
        }
        input.diagnostics.push(mojoAnalysisDiagnostic(
          "MOJO_DYNAMIC_THIS_CALLABLE_UNSUPPORTED",
          "A function-valued expression using dynamic 'this' requires an exact receiver-bearing method contract.",
          node,
        ));
        valid = false;
        return;
      }
      if (!ast.is.IsIdentifier(node)) return;
      const expressionType = input.expressionTypes.get(node);
      if (expressionType?.kind === "undefined" || expressionType?.kind === "null") return;
      const reference = input.source.navigation.sourceReferenceFor(node);
      if (reference?.project !== true) return;
      const declaration = reference?.declaration;
      if (declaration === undefined || nodeIsWithin(declaration, input.expression, ast) ||
        input.moduleBindingByDeclaration.has(declaration) || captures.has(declaration)) return;
      if (!captureEligibleDeclaration(declaration, ast)) return;
      const bindingName = input.bindingNames.get(declaration);
      const symbol = reference?.symbol;
      const type = input.bindingTypes.get(declaration);
      if (bindingName === undefined || symbol === undefined || type === undefined) {
        input.diagnostics.push(mojoAnalysisDiagnostic(
          "MOJO_CALLABLE_CAPTURE_IDENTITY_MISSING",
          "A captured source binding requires one exact declaration, symbol, target name, and carrier.",
          node,
        ));
        valid = false;
        return;
      }
      if (declaration === input.recursiveDeclaration) {
        if (type.kind !== "callable") {
          input.diagnostics.push(mojoAnalysisDiagnostic(
            "MOJO_RECURSIVE_CALLABLE_CARRIER_NOT_CLOSED",
            "A recursive callable binding requires one exact callable carrier.",
            node,
          ));
          valid = false;
          return;
        }
        recursiveBinding = Object.freeze({ declaration, name: bindingName, type });
        return;
      }
      const mutated = input.source.navigation.bindingWritesWithin(symbol, input.sourceFile).length > 0;
      const existingLocation = input.locationStorageNames.get(declaration);
      const storage = existingLocation !== undefined || mutated ? "location" : "value";
      const name = storage === "location"
        ? existingLocation ?? input.ensureLocationStorage(declaration, bindingName)
        : bindingName;
      captures.set(declaration, Object.freeze({
        declaration,
        name,
        type,
        storage,
      }));
    }, (node) => !isNestedCallable(node, ast));
  }
  if (!valid) return undefined;
  if (capturesSelf && (input.owner === undefined || !ast.is.IsArrowFunction(input.expression))) {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_DYNAMIC_THIS_CALLABLE_UNSUPPORTED",
      "A nested lexical receiver requires an exact enclosing arrow or method receiver.",
      input.expression,
    ));
    return undefined;
  }
  const ordered = [...captures.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en"));
  if (capturesSelf) {
    ordered.unshift(Object.freeze({
      declaration: input.expression,
      name: "self",
      type: input.owner!.type,
      storage: "value",
    }));
  }
  return Object.freeze({
    captures: Object.freeze(ordered),
    ...(recursiveBinding === undefined ? {} : { recursiveBinding }),
  });
}
