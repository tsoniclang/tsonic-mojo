import type { Node } from "@tsonic/tsts";
import {
  CatchClause_Block,
  Node_Expression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
} from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoCallSelection,
  MojoElementSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoValueSelection,
} from "./model.js";
import {
  mergeMojoErrorTypes,
  mojoConversionRaises,
  mojoNativeErrorType,
  mojoOperationErrorTypes,
  providerCallRequiresRaisingConversion,
} from "./effects.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";

export interface MojoErrorRegionIndexes {
  readonly source: TargetSourceProgram;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly callDependencies: WeakMap<Node, Node>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly elementSelections: WeakMap<Node, MojoElementSelection>;
  readonly resourceManagementSelections: WeakMap<Node, MojoResourceManagementSelection>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
}

export interface MojoErrorEffectOwner {
  readonly declaration: Node;
  readonly roots: readonly Node[];
}

export interface MojoErrorEffectClosure {
  readonly errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>;
  readonly converged: boolean;
}

export interface MojoProgramErrorEffectClosure extends MojoErrorEffectClosure {
  readonly catchDomainsConsistent: boolean;
}

export function closeMojoDeclarationErrorEffects(
  owners: readonly MojoErrorEffectOwner[],
  indexes: MojoErrorRegionIndexes,
): MojoErrorEffectClosure {
  let current = new Map<Node, readonly MojoTargetTypeRef[]>(
    owners.map((owner) => [owner.declaration, Object.freeze([])] as const),
  );
  const maximumIterations = Math.max(16, owners.length * 4 + 4);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const next = new Map<Node, readonly MojoTargetTypeRef[]>();
    for (const owner of owners) {
      next.set(owner.declaration, mergeMojoErrorTypes(
        ...owner.roots.map((root) =>
          collectMojoEscapingErrorTypes(root, indexes, current)),
      ));
    }
    if (errorEffectMapsEqual(current, next, owners)) {
      return Object.freeze({ errorTypesByDeclaration: next, converged: true });
    }
    current = next;
  }
  return Object.freeze({ errorTypesByDeclaration: current, converged: false });
}

export function closeMojoProgramErrorEffects(
  owners: readonly MojoErrorEffectOwner[],
  executableRoots: readonly Node[],
  indexes: MojoErrorRegionIndexes,
  publishCatchDomain: (
    catchClause: Node,
    catchBlock: Node,
    errorType: MojoTargetTypeRef | undefined,
  ) => void,
): MojoProgramErrorEffectClosure {
  let closure = closeMojoDeclarationErrorEffects(owners, indexes);
  let catchDomains = collectMojoCatchDomains(
    executableRoots,
    indexes,
    closure.errorTypesByDeclaration,
  );
  const maximumIterations = Math.max(16, owners.length * 2 + executableRoots.length * 2 + 4);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    if (!catchDomains.consistent) {
      return Object.freeze({
        errorTypesByDeclaration: closure.errorTypesByDeclaration,
        converged: false,
        catchDomainsConsistent: false,
      });
    }
    for (const domain of catchDomains.domains.values()) {
      publishCatchDomain(domain.catchClause, domain.catchBlock, domain.errorType);
    }
    const nextClosure = closeMojoDeclarationErrorEffects(owners, indexes);
    const nextCatchDomains = collectMojoCatchDomains(
      executableRoots,
      indexes,
      nextClosure.errorTypesByDeclaration,
    );
    if (closure.converged && nextClosure.converged && nextCatchDomains.consistent &&
      errorEffectMapsEqual(closure.errorTypesByDeclaration, nextClosure.errorTypesByDeclaration, owners) &&
      catchDomainMapsEqual(catchDomains.domains, nextCatchDomains.domains)) {
      return Object.freeze({
        errorTypesByDeclaration: nextClosure.errorTypesByDeclaration,
        converged: true,
        catchDomainsConsistent: true,
      });
    }
    closure = nextClosure;
    catchDomains = nextCatchDomains;
  }
  return Object.freeze({
    errorTypesByDeclaration: closure.errorTypesByDeclaration,
    converged: false,
    catchDomainsConsistent: catchDomains.consistent,
  });
}

export function collectMojoEscapingErrorTypes(
  root: Node,
  indexes: MojoErrorRegionIndexes,
  errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
  onCatchDomain: (
    catchClause: Node,
    catchBlock: Node,
    errorType: MojoTargetTypeRef | undefined,
  ) => void = () => undefined,
): readonly MojoTargetTypeRef[] {
  const { ast } = indexes.source;
  const visit = (node: Node, regionRoot: Node): readonly MojoTargetTypeRef[] => {
    if (node !== regionRoot && isCallableBoundary(node, ast)) return Object.freeze([]);
    if (ast.is.IsTryStatement(node)) {
      const tryBlock = TryStatement_TryBlock(ast, node);
      const catchClause = TryStatement_CatchClause(ast, node);
      const catchBlock = CatchClause_Block(ast, catchClause);
      const finallyBlock = TryStatement_FinallyBlock(ast, node);
      const tryErrors = tryBlock === undefined
        ? Object.freeze([])
        : visit(tryBlock, tryBlock);
      if (catchClause !== undefined && catchBlock !== undefined) {
        const catchType = closedErrorType(tryErrors) ?? mojoNativeErrorType();
        onCatchDomain(catchClause, catchBlock, catchType);
        return mergeMojoErrorTypes(
          visit(catchBlock, catchBlock),
          finallyBlock === undefined ? Object.freeze([]) : visit(finallyBlock, finallyBlock),
        );
      }
      return mergeMojoErrorTypes(
        tryErrors,
        finallyBlock === undefined ? Object.freeze([]) : visit(finallyBlock, finallyBlock),
      );
    }
    const children = ast.children(node)
      .filter((child): child is Node => child !== undefined)
      .map((child) => visit(child, regionRoot));
    return mergeMojoErrorTypes(
      directMojoNodeErrorTypes(node, indexes, errorTypesByDeclaration),
      ...children,
    );
  };
  return visit(root, root);
}

export function collectMojoEvaluationErrorTypes(
  root: Node,
  indexes: MojoErrorRegionIndexes,
  errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
  cache: WeakMap<Node, readonly MojoTargetTypeRef[]> = new WeakMap(),
): readonly MojoTargetTypeRef[] {
  const { ast } = indexes.source;
  const visit = (node: Node): readonly MojoTargetTypeRef[] => {
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    let result: readonly MojoTargetTypeRef[];
    if (isCallableBoundary(node, ast)) {
      result = directMojoNodeErrorTypes(node, indexes, errorTypesByDeclaration);
    } else if (ast.is.IsTryStatement(node)) {
      const tryBlock = TryStatement_TryBlock(ast, node);
      const catchClause = TryStatement_CatchClause(ast, node);
      const catchBlock = CatchClause_Block(ast, catchClause);
      const finallyBlock = TryStatement_FinallyBlock(ast, node);
      const tryErrors = tryBlock === undefined ? Object.freeze([]) : visit(tryBlock);
      result = catchClause !== undefined && catchBlock !== undefined
        ? mergeMojoErrorTypes(
            visit(catchBlock),
            finallyBlock === undefined ? Object.freeze([]) : visit(finallyBlock),
          )
        : mergeMojoErrorTypes(
            tryErrors,
            finallyBlock === undefined ? Object.freeze([]) : visit(finallyBlock),
          );
    } else {
      result = mergeMojoErrorTypes(
        directMojoNodeErrorTypes(node, indexes, errorTypesByDeclaration),
        ...ast.children(node)
          .filter((child): child is Node => child !== undefined)
          .map(visit),
      );
    }
    cache.set(node, result);
    return result;
  };
  return visit(root);
}

export function directMojoNodeErrorTypes(
  node: Node,
  indexes: MojoErrorRegionIndexes,
  errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
): readonly MojoTargetTypeRef[] {
  const { ast } = indexes.source;
  const errors: MojoTargetTypeRef[] = [];
  const addNativeConversionError = (raises: boolean): void => {
    if (raises) errors.push(mojoNativeErrorType());
  };
  if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
    const selection = indexes.callSelections.get(node);
    if (selection?.kind === "provider") {
      errors.push(...mojoOperationErrorTypes(selection.operation));
      if (selection.propagatedCallbackParameterIndex !== undefined) {
        const callbackArguments = selection.arguments.filter((argument) =>
          argument.parameterIndex === selection.propagatedCallbackParameterIndex);
        const callbackArgument = callbackArguments.length === 1 ? callbackArguments[0] : undefined;
        const dependency = indexes.callDependencies.get(node);
        if (dependency !== undefined) {
          const dependencyErrors = errorTypesByDeclaration.get(dependency) ?? [];
          errors.push(...(dependencyErrors.length === 0
            ? [mojoNativeErrorType()]
            : dependencyErrors));
        } else if (callbackArgument?.sourceType.kind === "callable" &&
          callbackArgument.sourceType.raises) {
          errors.push(callbackArgument.sourceType.errorType ?? mojoNativeErrorType());
        }
        if (callbackArgument?.sourceType.kind === "callable" &&
          !callbackArgument.sourceType.raises) {
          errors.push(mojoNativeErrorType());
        }
      }
      addNativeConversionError(providerCallRequiresRaisingConversion(selection));
    } else if (selection?.kind === "project") {
      const dependency = indexes.callDependencies.get(node);
      if (dependency !== undefined) {
        errors.push(...(errorTypesByDeclaration.get(dependency) ?? []));
      }
      addNativeConversionError(
        selection.arguments.some((argument) => mojoConversionRaises(argument.conversion)) ||
        mojoConversionRaises(selection.resultConversion),
      );
    } else if (selection?.kind === "callable") {
      const dependency = indexes.callDependencies.get(node);
      if (dependency !== undefined) {
        errors.push(...(errorTypesByDeclaration.get(dependency) ?? []));
      } else if (selection.callableType.raises) {
        errors.push(selection.callableType.errorType ?? mojoNativeErrorType());
      }
      addNativeConversionError(
        selection.arguments.some((argument) => mojoConversionRaises(argument.conversion)) ||
        mojoConversionRaises(selection.resultConversion),
      );
    }
  }
  if (ast.is.IsThrowStatement(node)) {
    const expression = Node_Expression(ast, node);
    const type = expression === undefined ? undefined : indexes.expressionTypes.get(expression);
    if (type !== undefined) errors.push(type);
  }
  if (ast.is.IsPropertyAccessExpression(node)) {
    const selection = indexes.propertySelections.get(node);
    if (selection?.kind === "provider") {
      if (selection.readOperation !== undefined) {
        errors.push(...mojoOperationErrorTypes(selection.readOperation));
      }
      if (selection.writeOperation !== undefined) {
        errors.push(...mojoOperationErrorTypes(selection.writeOperation));
      }
      addNativeConversionError(
        (selection.receiverConversion !== undefined && mojoConversionRaises(selection.receiverConversion)) ||
        (selection.readResultConversion !== undefined && mojoConversionRaises(selection.readResultConversion)) ||
        (selection.writeValueConversion !== undefined && mojoConversionRaises(selection.writeValueConversion)),
      );
    } else if (selection?.kind === "provider-constant") {
      errors.push(...mojoOperationErrorTypes(selection.operation));
      addNativeConversionError(mojoConversionRaises(selection.readResultConversion));
    } else if (selection?.kind === "provider-static") {
      if (selection.readOperation !== undefined) {
        errors.push(...mojoOperationErrorTypes(selection.readOperation));
      }
      if (selection.writeOperation !== undefined) {
        errors.push(...mojoOperationErrorTypes(selection.writeOperation));
      }
      if (selection.readResultConversion !== undefined) {
        addNativeConversionError(mojoConversionRaises(selection.readResultConversion));
      }
      if (selection.writeValueConversion !== undefined) {
        addNativeConversionError(mojoConversionRaises(selection.writeValueConversion));
      }
    }
  }
  if (ast.is.IsIdentifier(node)) {
    const selection = indexes.valueSelections.get(node);
    if (selection !== undefined) {
      errors.push(...mojoOperationErrorTypes(selection.operation));
      addNativeConversionError(mojoConversionRaises(selection.resultConversion));
    }
  }
  if (ast.is.IsElementAccessExpression(node)) {
    const selection = indexes.elementSelections.get(node);
    if (selection !== undefined) {
      addNativeConversionError(
        mojoConversionRaises(selection.indexConversion) ||
        (selection.readResultConversion !== undefined &&
          mojoConversionRaises(selection.readResultConversion)) ||
        (selection.kind === "provider" && selection.writeValueConversion !== undefined &&
          mojoConversionRaises(selection.writeValueConversion)),
      );
      if (selection.kind === "provider") {
        if (selection.readOperation !== undefined) {
          errors.push(...mojoOperationErrorTypes(selection.readOperation));
        }
        if (selection.writeOperation !== undefined) {
          errors.push(...mojoOperationErrorTypes(selection.writeOperation));
        }
        addNativeConversionError(mojoConversionRaises(selection.receiverConversion));
      }
    }
  }
  if (ast.is.IsVariableDeclaration(node)) {
    const selection = indexes.resourceManagementSelections.get(node);
    if (selection !== undefined) {
      for (const alternative of selection.alternatives) {
        if (alternative.disposal.kind === "provider") {
          errors.push(...mojoOperationErrorTypes(alternative.disposal.operation));
        } else {
          errors.push(...(errorTypesByDeclaration.get(alternative.disposal.dependency) ?? []));
        }
      }
    }
  }
  return mergeMojoErrorTypes(errors);
}

function closedErrorType(types: readonly MojoTargetTypeRef[]): MojoTargetTypeRef | undefined {
  if (types.length === 0) return undefined;
  if (types.length === 1) return types[0];
  return Object.freeze({ kind: "union", members: types });
}

interface MojoCatchDomain {
  readonly catchClause: Node;
  readonly catchBlock: Node;
  readonly errorType?: MojoTargetTypeRef;
}

function collectMojoCatchDomains(
  roots: readonly Node[],
  indexes: MojoErrorRegionIndexes,
  errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
): {
  readonly domains: ReadonlyMap<Node, MojoCatchDomain>;
  readonly consistent: boolean;
} {
  const domains = new Map<Node, MojoCatchDomain>();
  let consistent = true;
  const collect = (
    catchClause: Node,
    catchBlock: Node,
    errorType: MojoTargetTypeRef | undefined,
  ): void => {
    const existing = domains.get(catchClause);
    if (existing !== undefined &&
      (existing.catchBlock !== catchBlock || !optionalTargetTypesEqual(existing.errorType, errorType))) {
      consistent = false;
      return;
    }
    domains.set(catchClause, Object.freeze({
      catchClause,
      catchBlock,
      ...(errorType === undefined ? {} : { errorType }),
    }));
  };
  for (const root of roots) {
    collectMojoEscapingErrorTypes(root, indexes, errorTypesByDeclaration, collect);
  }
  return Object.freeze({ domains, consistent });
}

function catchDomainMapsEqual(
  left: ReadonlyMap<Node, MojoCatchDomain>,
  right: ReadonlyMap<Node, MojoCatchDomain>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [catchClause, leftDomain] of left) {
    const rightDomain = right.get(catchClause);
    if (rightDomain === undefined || leftDomain.catchBlock !== rightDomain.catchBlock ||
      !optionalTargetTypesEqual(leftDomain.errorType, rightDomain.errorType)) return false;
  }
  return true;
}

function optionalTargetTypesEqual(
  left: MojoTargetTypeRef | undefined,
  right: MojoTargetTypeRef | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : mojoTargetTypeEquals(left, right);
}

function errorEffectMapsEqual(
  left: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
  right: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
  owners: readonly MojoErrorEffectOwner[],
): boolean {
  return owners.every((owner) => {
    const leftTypes = left.get(owner.declaration) ?? [];
    const rightTypes = right.get(owner.declaration) ?? [];
    return leftTypes.length === rightTypes.length && leftTypes.every((type, index) =>
      mojoTargetTypeEquals(type, rightTypes[index]!));
  });
}

function isCallableBoundary(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) ||
    ast.is.IsArrowFunction(node) ||
    ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) ||
    ast.is.IsSetAccessorDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node);
}
