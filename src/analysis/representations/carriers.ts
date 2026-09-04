import { createHash } from "node:crypto";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoValueRefinementSelection } from "../refinements/model.js";
import type { MojoAnalyzedParameter } from "../program/model.js";
import type {
  MojoAnalyzedModule,
  MojoAnalyzedTypeAlias,
  MojoCallableExpressionSelection,
} from "../program/model.js";
import type { MojoCallSelection } from "../program/call-model.js";
import { resolveMojoCallableExpressionDependency } from "../callables/expressions.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { SourceProgramNavigation, TargetSourceProgram } from "@tsonic/target-api/source";
import { walkSourceTree } from "../../source/syntax/traversal.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import { createMojoNarrowingView } from "./narrowing.js";
import { classifyMojoCallableDisposition } from "./callables.js";
import { selectMojoAuthoredTypeAlias } from "./aliases.js";
import type {
  MojoBindingDisposition,
  MojoCallableDisposition,
  MojoNarrowingView,
  MojoPhysicalCarrier,
  MojoPhysicalTypeId,
  MojoRepresentationCatalog,
} from "./model.js";

export interface MojoRepresentationCatalogInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly rootTypes: readonly MojoTargetTypeRef[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly modules: readonly MojoAnalyzedModule[];
  readonly sourceModules: MojoSourceModuleCatalog;
  readonly authoredTypeAliases: readonly MojoAnalyzedTypeAlias[];
  readonly sourceNavigation: TargetPlanningSourceNavigation;
  readonly callableNavigation: SourceProgramNavigation;
  readonly source: TargetSourceProgram;
  readonly callableExpressionNodes: ReadonlySet<Node>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly callableDeclarationByExpression: WeakMap<Node, Node>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly lifecycle: MojoLifecycleResolver;
  readonly diagnostics: TargetDiagnostic[];
  readonly reservedNames: ReadonlySet<string>;
}

export function createMojoRepresentationCatalog(
  input: MojoRepresentationCatalogInput,
): MojoRepresentationCatalog {
  const carriersById = new Map<MojoPhysicalTypeId, MojoPhysicalCarrier>();
  const carriersByKey = new Map<string, MojoPhysicalTypeId>();
  const bindingCarriers = new WeakMap<Node, MojoPhysicalTypeId>();
  const expressionCarriers = new WeakMap<Node, MojoPhysicalTypeId>();
  const narrowings = new WeakMap<Node, MojoNarrowingView>();
  const parameterDispositions = new WeakMap<Node, import("./model.js").MojoParameterDisposition>();
  const callableDispositions = new WeakMap<Node, MojoCallableDisposition>();
  const bindingDispositions = new WeakMap<Node, MojoBindingDisposition>();
  const directCallableExpressions = new Map<Node, "direct" | "thin">();
  const requiredErasedCallableExpressions = new Set<Node>();
  const carrierUseCounts = new Map<string, number>();
  const authoredAliasCandidates = Object.freeze(input.authoredTypeAliases.flatMap((alias) => {
    const module = input.sourceModules.forSourceFile(alias.sourceFile);
    return module === undefined ? [] : [Object.freeze({ alias, modulePath: module.modulePath })];
  }));

  const carrierForType = (type: MojoTargetTypeRef): MojoPhysicalTypeId => {
    const key = mojoTargetTypeKey(type);
    const existing = carriersByKey.get(key);
    if (existing !== undefined) return existing;
    for (const child of childTypes(type)) carrierForType(child);
    for (const support of physicalSupportTypes(type)) carrierForType(support);
    const id = physicalTypeId(key);
    const collision = carriersById.get(id);
    if (collision !== undefined && collision.key !== key) {
      throw new Error(`Mojo physical carrier identity collision '${id}'.`);
    }
    carriersByKey.set(key, id);
    carriersById.set(id, Object.freeze({ id, key, type }));
    return id;
  };

  const recordTypeUse = (type: MojoTargetTypeRef): MojoPhysicalTypeId => {
    const key = mojoTargetTypeKey(type);
    carrierUseCounts.set(key, (carrierUseCounts.get(key) ?? 0) + 1);
    const id = carrierForType(type);
    for (const child of childTypes(type)) recordTypeUse(child);
    for (const support of physicalSupportTypes(type)) recordTypeUse(support);
    return id;
  };

  for (const type of input.rootTypes) recordTypeUse(type);
  for (const parameter of input.parameters) {
    parameterDispositions.set(parameter.declaration, parameter.disposition);
  }
  for (const module of input.modules) {
    for (const binding of module.bindings) {
      bindingDispositions.set(binding.declaration, binding.disposition);
      if (binding.disposition.kind === "direct-function") {
        directCallableExpressions.set(
          binding.disposition.expression,
          binding.disposition.callableKind,
        );
      }
    }
  }
  for (const sourceFile of input.sourceFiles) {
    walkSourceTree(sourceFile, input.ast, (node): void => {
      const call = input.callSelections.get(node);
      if (call === undefined || !("arguments" in call)) return;
      for (const argument of call.arguments) {
        recordTypeUse(argument.sourceType);
        recordTypeUse(argument.parameterType);
        if (argument.sourceContainerType !== undefined) {
          recordTypeUse(argument.sourceContainerType);
        }
        if (argument.callableConsumption !== "retained") continue;
        const expression = resolveMojoCallableExpressionDependency(
          argument.expression,
          input.source,
          input.callableExpressionSelections,
          input.callableDeclarationByExpression,
        );
        if (expression === undefined) {
          input.diagnostics.push(mojoAnalysisDiagnostic(
            "MOJO_REQUIRED_ERASED_CALLABLE_UNRESOLVED",
            "A retained callback parameter requires one exact callable expression before representation sealing.",
            argument.expression,
          ));
          continue;
        }
        requiredErasedCallableExpressions.add(expression);
      }
    });
  }
  for (const expression of input.callableExpressionNodes) {
    const selection = input.callableExpressionSelections.get(expression);
    if (selection === undefined) continue;
    const declaration = input.callableDeclarationByExpression.get(expression);
    const directKind = directCallableExpressions.get(expression);
    const disposition: MojoCallableDisposition = requiredErasedCallableExpressions.has(expression)
      ? Object.freeze({
          kind: "erased",
          expression,
          ...(declaration === undefined ? {} : { declaration }),
          identityObserved: false,
        })
      : directKind === undefined
      ? classifyMojoCallableDisposition(
          expression,
          declaration,
          selection,
          input.callableNavigation,
          input.ast,
        )
      : Object.freeze({
          kind: directKind,
          expression,
          ...(declaration === undefined ? {} : { declaration }),
        });
    callableDispositions.set(expression, disposition);
    if (declaration !== undefined) callableDispositions.set(declaration, disposition);
    if (disposition.kind === "erased") {
      for (const capture of selection.captures) {
        if (capture.storage === "location" ||
          input.lifecycle.capabilities(capture.type).copy !== "unavailable") continue;
        input.diagnostics.push(mojoAnalysisDiagnostic(
          "MOJO_ESCAPING_MOVE_ONLY_CAPTURE_UNSUPPORTED",
          "An escaping callable cannot retain a move-only value without an exact authored transfer contract.",
          capture.declaration,
        ));
      }
    }
    recordTypeUse(selection.callableType);
    recordTypeUse(selection.resultType);
    for (const parameter of selection.parameters) {
      parameterDispositions.set(parameter.declaration, parameter.disposition);
      recordTypeUse(parameter.type);
      recordTypeUse(parameter.bodyType);
      recordTypeUse(parameter.callType);
    }
    for (const capture of selection.captures) recordTypeUse(capture.type);
    if (selection.errorType !== undefined) recordTypeUse(selection.errorType);
  }
  for (const sourceFile of input.sourceFiles) {
    walkSourceTree(sourceFile, input.ast, (node): void => {
      const bindingType = input.bindingTypes.get(node);
      if (bindingType !== undefined) {
        bindingCarriers.set(node, recordTypeUse(bindingType));
      }
      const expressionType = input.expressionTypes.get(node);
      const refinement = input.valueRefinements.get(node);
      if (expressionType !== undefined) recordTypeUse(expressionType);
      if (refinement !== undefined) {
        recordTypeUse(refinement.sourceType);
        recordTypeUse(refinement.resultType);
        const narrowing = createMojoNarrowingView(refinement, { carrierForType });
        narrowings.set(node, narrowing);
        expressionCarriers.set(
          node,
          refinement.kind === "union-subset"
            ? narrowing.carrier
            : recordTypeUse(refinement.resultType),
        );
      } else if (expressionType !== undefined) {
        expressionCarriers.set(node, recordTypeUse(expressionType));
      }
      const reference = input.sourceNavigation.sourceReferenceFor(node);
      if (reference?.project === true) {
        const callable = callableDispositions.get(reference.declaration);
        if (callable !== undefined) callableDispositions.set(node, callable);
        const binding = bindingDispositions.get(reference.declaration);
        if (binding !== undefined) bindingDispositions.set(node, binding);
      }
    });
  }

  const occupiedAliasNames = new Set(input.reservedNames);
  for (const [id, carrier] of [...carriersById.entries()].sort(([left], [right]) =>
    left.localeCompare(right, "en"))) {
    if (!requiresNamedCarrier(
      carrier.type,
      carrierUseCounts.get(carrier.key) ?? 0,
      carrier.key.length,
    )) continue;
    const base = `_${carrierAliasBase(carrier.type)}`;
    let width = 8;
    let alias = base;
    while (occupiedAliasNames.has(alias)) {
      alias = `${base}_${id.slice("mojo-physical:".length, "mojo-physical:".length + width)}`;
      width += 2;
      if (width > 64) throw new Error(`Unable to allocate a unique Mojo carrier alias for '${id}'.`);
    }
    occupiedAliasNames.add(alias);
    carriersById.set(id, Object.freeze({ ...carrier, alias }));
  }
  const orderedCarriers = Object.freeze([...carriersById.values()].sort((left, right) =>
    left.id.localeCompare(right.id, "en")));
  return Object.freeze({
    carrier(id: MojoPhysicalTypeId): MojoPhysicalCarrier | undefined {
      return carriersById.get(id);
    },
    carrierForType(type: MojoTargetTypeRef): MojoPhysicalTypeId {
      const id = carriersByKey.get(mojoTargetTypeKey(type));
      if (id === undefined) {
        throw new Error(`Mojo physical carrier was not sealed for '${mojoTargetTypeKey(type)}'.`);
      }
      return id;
    },
    bindingCarrier(declaration: Node): MojoPhysicalTypeId | undefined {
      return bindingCarriers.get(declaration);
    },
    expressionCarrier(expression: Node): MojoPhysicalTypeId | undefined {
      return expressionCarriers.get(expression);
    },
    narrowing(expression: Node): MojoNarrowingView | undefined {
      return narrowings.get(expression);
    },
    narrowingFor(refinement: MojoValueRefinementSelection): MojoNarrowingView {
      return createMojoNarrowingView(refinement, {
        carrierForType(type: MojoTargetTypeRef): MojoPhysicalTypeId {
          const id = carriersByKey.get(mojoTargetTypeKey(type));
          if (id === undefined) {
            throw new Error(`Mojo narrowing carrier was not sealed for '${mojoTargetTypeKey(type)}'.`);
          }
          return id;
        },
      });
    },
    callable(referenceOrExpression: Node) {
      const direct = callableDispositions.get(referenceOrExpression);
      if (direct !== undefined) return direct;
      const expression = resolveMojoCallableExpressionDependency(
        referenceOrExpression,
        input.source,
        input.callableExpressionSelections,
        input.callableDeclarationByExpression,
      );
      return expression === undefined ? undefined : callableDispositions.get(expression);
    },
    parameter(declaration: Node) {
      return parameterDispositions.get(declaration);
    },
    binding(referenceOrDeclaration: Node) {
      return bindingDispositions.get(referenceOrDeclaration);
    },
    aliasForType(type: MojoTargetTypeRef, modulePath: readonly string[]) {
      const authored = selectMojoAuthoredTypeAlias(type, modulePath, authoredAliasCandidates);
      if (authored !== undefined) return authored;
      const id = carriersByKey.get(mojoTargetTypeKey(type));
      const alias = id === undefined ? undefined : carriersById.get(id)?.alias;
      return alias === undefined
        ? undefined
        : Object.freeze({
            kind: "generated" as const,
            name: alias,
            genericArguments: Object.freeze([]) as readonly [],
            aliasedTypeKey: mojoTargetTypeKey(type),
          });
    },
    carriers(): readonly MojoPhysicalCarrier[] {
      return orderedCarriers;
    },
  });
}

function requiresNamedCarrier(
  type: MojoTargetTypeRef,
  useCount: number,
  keyLength: number,
): boolean {
  if (!isClosedCarrier(type)) return false;
  const complexity = carrierComplexity(type);
  return (type.kind === "union" && type.members.length >= 4) ||
    keyLength >= 480 ||
    (useCount >= 2 && complexity >= 8);
}

function isClosedCarrier(type: MojoTargetTypeRef): boolean {
  if (type.kind === "type-parameter" || type.kind === "compiler-expression") return false;
  if (type.kind === "reference" &&
    (type.origin.kind === "parameter" || type.origin.kind === "inferred" ||
      type.origin.kind === "provider-expression")) return false;
  if (type.kind === "function" && type.capture !== undefined) return false;
  return childTypes(type).every(isClosedCarrier);
}

function carrierComplexity(type: MojoTargetTypeRef): number {
  return 1 + childTypes(type).reduce((total, child) => total + carrierComplexity(child), 0);
}

function carrierAliasBase(type: MojoTargetTypeRef): string {
  switch (type.kind) {
    case "union": {
      const labels = type.members.slice(0, 3).map(carrierTypeLabel);
      const descriptive = `${labels.join("Or")}${type.members.length > 3 ? "OrMore" : ""}`;
      return descriptive.length > 0 && descriptive.length <= 56 ? descriptive : "ValueUnion";
    }
    case "callable":
    case "function": return "CallbackType";
    case "tuple": {
      const descriptive = `${type.elements.slice(0, 3).map(carrierTypeLabel).join("And")}${
        type.elements.length > 3 ? "AndMore" : ""}Tuple`;
      return descriptive.length <= 56 ? descriptive : "ValueTuple";
    }
    case "optional": {
      const descriptive = `Optional${carrierTypeLabel(type.value)}`;
      return descriptive.length <= 56 ? descriptive : "OptionalValue";
    }
    case "target-named": return `${pascalIdentifier(type.name)}Type`;
    case "dictionary": return "ValueDictionary";
    case "list": return "ValueList";
    case "fixed-array": return "ValueArray";
    case "future": return "FutureValue";
    case "reference": return "ValueReference";
    case "associated": return "AssociatedType";
    default: return "ValueType";
  }
}

function carrierTypeLabel(type: MojoTargetTypeRef): string {
  switch (type.kind) {
    case "source-primitive": return pascalIdentifier(type.name);
    case "native-string": return "String";
    case "unit": return "Unit";
    case "never": return "Never";
    case "null": return "Null";
    case "undefined": return "Undefined";
    case "dynamic": return type.domain === "js" ? "JsValue" : "TsValue";
    case "bigint": return "BigInt";
    case "symbol": return "Symbol";
    case "type-parameter": return pascalIdentifier(type.name);
    case "target-named": return pascalIdentifier(type.name);
    case "list": return `${carrierTypeLabel(type.element)}List`;
    case "fixed-array": return `${carrierTypeLabel(type.element)}Array`;
    case "dictionary": return `${carrierTypeLabel(type.key)}To${carrierTypeLabel(type.value)}Dict`;
    case "future": return `${carrierTypeLabel(type.output)}Future`;
    case "optional": return `Optional${carrierTypeLabel(type.value)}`;
    case "union": return "ValueUnion";
    case "tuple": return "ValueTuple";
    case "associated": return pascalIdentifier(
      type.memberPath[type.memberPath.length - 1] ?? "Associated",
    );
    case "compiler-expression": return "CompilerType";
    case "reference": return `${carrierTypeLabel(type.value)}Ref`;
    case "callable":
    case "function": return "Callback";
  }
}

function pascalIdentifier(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/u).filter((word) => word.length > 0);
  const joined = words.map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`).join("");
  return /^[A-Za-z_]/u.test(joined) && joined.length > 0 ? joined : "Named";
}

function physicalTypeId(key: string): MojoPhysicalTypeId {
  return `mojo-physical:${createHash("sha256").update(key).digest("hex")}` as MojoPhysicalTypeId;
}

function childTypes(type: MojoTargetTypeRef): readonly MojoTargetTypeRef[] {
  switch (type.kind) {
    case "list": return Object.freeze([type.element]);
    case "fixed-array": return Object.freeze([type.element]);
    case "dictionary": return Object.freeze([type.key, type.value]);
    case "future": return Object.freeze([type.output]);
    case "optional": return Object.freeze([type.value]);
    case "union": return type.members;
    case "tuple": return type.elements;
    case "associated": return Object.freeze([
      type.owner,
      ...genericArgumentTypes(type.genericArguments),
    ]);
    case "reference": return Object.freeze([type.value]);
    case "callable": return Object.freeze([
      ...type.parameters.map((parameter) => parameter.type),
      type.result,
      ...(type.errorType === undefined ? [] : [type.errorType]),
    ]);
    case "function": return Object.freeze([
      ...type.genericParameters.flatMap((parameter) => [
        ...parameter.constraints,
        ...(parameter.defaultArgument?.kind === "type" ? [parameter.defaultArgument.type] : []),
      ]),
      ...type.parameters.map((parameter) => parameter.type),
      type.result,
      ...(type.errorType === undefined ? [] : [type.errorType]),
    ]);
    case "target-named": return genericArgumentTypes(type.genericArguments ?? []);
    case "source-primitive":
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "dynamic":
    case "bigint":
    case "symbol":
    case "type-parameter":
    case "compiler-expression":
      return Object.freeze([]);
  }
}

function physicalSupportTypes(type: MojoTargetTypeRef): readonly MojoTargetTypeRef[] {
  if (type.kind !== "callable") return Object.freeze([]);
  return Object.freeze([Object.freeze({
    kind: "tuple",
    elements: Object.freeze(type.parameters.map((parameter) => parameter.type)),
  })]);
}

function genericArgumentTypes(
  arguments_: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[],
): readonly MojoTargetTypeRef[] {
  return Object.freeze(arguments_.flatMap((argument) =>
    argument.kind === "type" ? [argument.type] : []));
}
