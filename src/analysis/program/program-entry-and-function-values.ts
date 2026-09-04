import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { mojoParameterConvention } from "../representations/index.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type {
  MojoAnalyzedFunction,
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoTargetAnalysisRequest,
} from "./model.js";

export function selectMojoBinaryEntry(
  outputType: "bin" | "lib",
  modules: MojoSourceModuleCatalog,
  functions: readonly import("./model.js").MojoAnalyzedTopLevelFunction[],
  navigation: MojoTargetAnalysisRequest["input"]["source"]["navigation"],
  diagnostics: TargetDiagnostic[],
): import("./model.js").MojoAnalyzedTopLevelFunction | undefined {
  if (outputType !== "bin") return undefined;
  const exported = modules.entryPoint.exports.filter(({ exportName }) => exportName === "main");
  const candidates = [...new Set(exported.flatMap((entry) => {
    const selected = navigation.callableImplementation(entry.declaration);
    const declaration = selected.kind === "resolved"
      ? selected.implementation.declaration
      : entry.declaration;
    return functions.filter((function_) => function_.declaration === declaration);
  }))];
  const selected = candidates.length === 1 ? candidates[0] : undefined;
  if (selected === undefined || selected.parameters.length !== 0 ||
    selected.typeParameters.length !== 0 || selected.resultType.kind !== "unit") {
    diagnostics.push(diagnostic(
      "MOJO_BINARY_ENTRYPOINT_UNSUPPORTED",
      "Binary output requires the configured entry module to export exactly one non-generic 'main' function with no parameters and a void result.",
      modules.entryPoint.sourceFile,
    ));
    return undefined;
  }
  return selected;
}

export function addMojoFirstClassFunctionBindings(
  modules: readonly MojoAnalyzedModule[],
  contracts: readonly import("./model.js").MojoAnalyzedCallableSignature[],
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
  source: MojoTargetAnalysisRequest["input"]["source"],
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  bindingTypes: WeakMap<Node, MojoTargetTypeRef>,
  conversions: import("../../policy/conversions/selection.js").MojoConversionIndex,
  relationships: import("../../target-model/types/project.js").MojoProjectTypeRelationships,
  diagnostics: TargetDiagnostic[],
): readonly MojoAnalyzedModule[] {
  const contractGroups = new Map<Node, {
    readonly implementation: MojoAnalyzedFunction;
    readonly contracts: import("./model.js").MojoAnalyzedCallableSignature[];
  }>();
  for (const contract of contracts) {
    const selected = source.navigation.callableImplementation(contract.declaration);
    const implementation = selected.kind === "resolved"
      ? implementations.get(selected.implementation.declaration)
      : implementations.get(contract.declaration);
    if (implementation === undefined || implementation.kind !== "function") continue;
    const group = contractGroups.get(implementation.declaration) ?? {
      implementation,
      contracts: [],
    };
    group.contracts.push(contract);
    contractGroups.set(implementation.declaration, group);
  }
  const uses = new Map<Node, ReturnType<
    MojoTargetAnalysisRequest["input"]["source"]["navigation"]["declarationUseSummary"]
  >["uses"][number]>();
  for (const contract of contracts) {
    for (const use of source.navigation.declarationUseSummary(contract.declaration).uses) {
      if (use.kind === "first-class" && !isCallableDeclarationName(use.reference, source)) {
        uses.set(use.reference, use);
      }
    }
  }
  const bindingsBySourceFile = new Map<SourceFile, Map<Node, {
    readonly target: import("./model.js").MojoAnalyzedCallableSignature;
    readonly type: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
    readonly references: Node[];
  }>>();
  for (const use of uses.values()) {
    const reference = source.navigation.sourceReferenceFor(use.reference);
    const selected = reference === undefined
      ? undefined
      : source.navigation.callableImplementation(reference.declaration);
    const group = selected?.kind === "resolved"
      ? contractGroups.get(selected.implementation.declaration)
      : undefined;
    const expected = expressionTypes.get(use.reference);
    if (group === undefined || expected?.kind !== "callable") {
      diagnostics.push(diagnostic(
        "MOJO_FIRST_CLASS_FUNCTION_CARRIER_UNRESOLVED",
        "A first-class project function reference requires one exact implementation group and callable carrier.",
        use.reference,
      ));
      continue;
    }
    const candidates = group.contracts.flatMap((contract) => {
      const target = functionValueTarget(contract, group.implementation);
      if (target === undefined) return [];
      const type = functionValueCallableType(target, group.implementation);
      const conversion = classifyMojoValueConversion(type, expected, undefined, relationships);
      return conversion.kind === "resolved"
        ? [Object.freeze({ target, type, conversion: conversion.conversion })]
        : [];
    });
    const exact = candidates.filter((candidate) => mojoTargetTypeEquals(candidate.type, expected));
    const selectedCandidates = exact.length > 0 ? exact : candidates;
    const unique = selectedCandidates.filter((candidate, index, all) =>
      all.findIndex((other) => mojoTargetTypeEquals(other.type, candidate.type) &&
        other.target.name === candidate.target.name) === index);
    const candidate = unique.length === 1 ? unique[0] : undefined;
    if (candidate === undefined) {
      diagnostics.push(diagnostic(
        unique.length === 0
          ? "MOJO_FIRST_CLASS_FUNCTION_ABI_UNSUPPORTED"
          : "MOJO_FIRST_CLASS_FUNCTION_OVERLOAD_AMBIGUOUS",
        unique.length === 0
          ? "No exact project function overload can satisfy the selected first-class callable ABI."
          : "More than one project function overload can satisfy the selected first-class callable ABI.",
        use.reference,
      ));
      continue;
    }
    const finalized = conversions.finalizeCallable(use.reference, candidate.type, expected);
    if (finalized.kind === "unsupported") {
      diagnostics.push(diagnostic(
        "MOJO_FIRST_CLASS_FUNCTION_CONVERSION_UNPROVEN",
        finalized.reason,
        use.reference,
      ));
      continue;
    }
    expressionTypes.set(use.reference, candidate.type);
    bindingTypes.set(use.reference, candidate.type);
    const ownerBindings = bindingsBySourceFile.get(group.implementation.sourceFile) ?? new Map();
    const existing = ownerBindings.get(candidate.target.declaration);
    if (existing === undefined) {
      ownerBindings.set(candidate.target.declaration, {
        target: candidate.target,
        type: candidate.type,
        references: [use.reference],
      });
    } else {
      existing.references.push(use.reference);
    }
    bindingsBySourceFile.set(group.implementation.sourceFile, ownerBindings);
  }
  return Object.freeze(modules.map((module) => {
    const selectedFunctions = [...(bindingsBySourceFile.get(module.sourceFile)?.values() ?? [])];
    if (selectedFunctions.length === 0) return module;
    const occupiedNames = new Set(module.bindings.map((binding) => binding.name));
    const bindings = [...module.bindings];
    const functionValueSteps: import("./model.js").MojoModuleInitializationStep[] = [];
    for (const selected of selectedFunctions) {
      const function_ = selected.target;
      const name = allocateFunctionValueName(occupiedNames, `${function_.name}_value`);
      const sourceNameNode = source.ast.name(function_.declaration);
      const binding = Object.freeze({
        kind: "function-value" as const,
        declaration: selected.references[0]!,
        sourceFile: function_.sourceFile,
        sourceName: sourceNameNode === undefined ? function_.name : source.ast.text(sourceNameNode),
        name,
        declarationKind: "const" as const,
        disposition: Object.freeze({ kind: "immutable-runtime" as const }),
        type: selected.type,
        initializer: selected.references[0]!,
        functionValue: function_,
        references: Object.freeze(selected.references),
      }) satisfies MojoAnalyzedModuleBinding;
      bindings.push(binding);
      functionValueSteps.push(Object.freeze({ kind: "binding" as const, binding }));
    }
    if (bindings.length === module.bindings.length) return module;
    return Object.freeze({
      ...module,
      bindings: Object.freeze(bindings),
      initializationSteps: Object.freeze([
        ...functionValueSteps,
        ...module.initializationSteps,
      ]),
      directRuntimeInitializationRequired: true,
      initializationStateRequired: true,
      runtimeInitializationRequired: true,
    });
  }));
}

function functionValueTarget(
  contract: import("./model.js").MojoAnalyzedCallableSignature,
  implementation: MojoAnalyzedFunction,
): import("./model.js").MojoAnalyzedCallableSignature | undefined {
  if (contract.asynchronous || contract.typeParameters.length !== 0 ||
    contract.parameters.some((parameter) => {
      const convention = mojoParameterConvention(parameter.disposition);
      return convention !== "imm" && convention !== "var";
    })) return undefined;
  if (contract.declaration === implementation.declaration) return implementation;
  return contract.implementationAdapterName === undefined
    ? undefined
    : Object.freeze({
        ...contract,
        name: contract.implementationAdapterName,
        raises: implementation.raises,
        ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
      });
}

function functionValueCallableType(
  target: import("./model.js").MojoAnalyzedCallableSignature,
  implementation: MojoAnalyzedFunction,
): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> {
  return Object.freeze({
    kind: "callable",
    parameters: Object.freeze(target.parameters.map((parameter) => Object.freeze({
      name: parameter.name,
      convention: mojoParameterConvention(parameter.disposition),
      passing: parameter.disposition.kind === "owned" ? "consume" as const : "plain" as const,
      type: parameter.callType,
      omissionKind: parameter.omissionKind,
    }))),
    result: target.resultType,
    raises: implementation.raises,
    ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
  });
}

function isCallableDeclarationName(
  reference: Node,
  source: MojoTargetAnalysisRequest["input"]["source"],
): boolean {
  const parent = source.ast.parent(reference);
  return parent !== undefined && source.ast.name(parent) === reference &&
    (source.ast.is.IsFunctionDeclaration(parent) ||
      source.ast.is.IsMethodDeclaration(parent) ||
      source.ast.is.IsConstructorDeclaration(parent));
}

function allocateFunctionValueName(occupied: Set<string>, requested: string): string {
  let candidate = requested;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${requested}_${suffix}`;
    suffix += 1;
  }
  occupied.add(candidate);
  return candidate;
}

