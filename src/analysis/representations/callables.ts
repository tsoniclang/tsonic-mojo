import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { MojoCallableExpressionSelection } from "../program/model.js";
import type { MojoCallableDisposition } from "./model.js";

export function classifyMojoCallableDisposition(
  expression: Node,
  declaration: Node | undefined,
  selection: MojoCallableExpressionSelection,
  navigation: SourceProgramNavigation,
  ast: AstReader,
): MojoCallableDisposition {
  const use = declaration === undefined
    ? undefined
    : navigation.declarationUseSummary(declaration);
  const identityObserved = use?.identityCompared === true;
  const escapes = use?.aliasedOrStored === true ||
    use?.captured === true ||
    use?.hasUnclassifiedValueUse === true ||
    (use?.escapeKinds.some((kind) => kind !== "export" && kind !== "argument") ?? false);
  if (identityObserved || escapes || selection.recursiveBinding !== undefined) {
    return Object.freeze({
      kind: "erased",
      expression,
      ...(declaration === undefined ? {} : { declaration }),
      identityObserved,
    });
  }
  if (selection.captures.length > 0 && nativeClosureEligible(selection, ast)) {
    return Object.freeze({
      kind: "native-closure",
      expression,
      ...(declaration === undefined ? {} : { declaration }),
    });
  }
  if (selection.captures.length > 0) {
    return Object.freeze({
      kind: "erased",
      expression,
      ...(declaration === undefined ? {} : { declaration }),
      identityObserved: false,
    });
  }
  if (declaration === undefined || (use?.firstClassUseCount ?? 0) > 0) {
    return Object.freeze({
      kind: "thin",
      expression,
      ...(declaration === undefined ? {} : { declaration }),
    });
  }
  return Object.freeze({
    kind: "direct",
    expression,
    ...(declaration === undefined ? {} : { declaration }),
  });
}

function nativeClosureEligible(
  selection: MojoCallableExpressionSelection,
  ast: AstReader,
): boolean {
  return !ast.is.IsBlock(selection.body) &&
    selection.parameters.every((parameter) =>
      parameter.omissionKind === "required" &&
      (parameter.disposition.kind !== "immutable" || !parameter.disposition.localCopy));
}
