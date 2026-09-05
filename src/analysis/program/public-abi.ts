import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoPublicModuleBindingAbi,
} from "./model.js";

export function finalizeMojoPublicModuleBindingAbis(
  modules: readonly MojoAnalyzedModule[],
  sourceModules: MojoSourceModuleCatalog,
  lifecycle: MojoLifecycleResolver,
  diagnostics: TargetDiagnostic[],
): readonly MojoAnalyzedModule[] {
  const exportedDeclarations = new Set(
    sourceModules.entryPoint.exports.map((exported) => exported.declaration),
  );
  return Object.freeze(modules.map((module) => Object.freeze({
    ...module,
    bindings: Object.freeze(module.bindings.map((binding) => {
      if (!exportedDeclarations.has(binding.declaration) || binding.kind === "function-value" ||
        (binding.disposition.kind !== "immutable-runtime" &&
          binding.disposition.kind !== "live-cell")) return binding;
      const publicAbi = publicBindingAbi(binding, lifecycle, diagnostics);
      return publicAbi === undefined ? binding : Object.freeze({ ...binding, publicAbi });
    })),
  })));
}

function publicBindingAbi(
  binding: MojoAnalyzedModuleBinding,
  lifecycle: MojoLifecycleResolver,
  diagnostics: TargetDiagnostic[],
): MojoPublicModuleBindingAbi | undefined {
  if (binding.type.kind === "callable") {
    const unsupportedRest = binding.type.parameters.find((parameter) =>
      parameter.omissionKind === "rest" && collectionElement(parameter.type) === undefined);
    if (unsupportedRest !== undefined) {
      diagnostics.push(diagnostic(
        "MOJO_PUBLIC_CALLABLE_REST_ABI_UNSUPPORTED",
        `Public callable '${binding.sourceName}' has a rest parameter without an exact native sequence carrier.`,
        binding.declaration,
      ));
      return undefined;
    }
    return Object.freeze({ kind: "callable" });
  }
  const copy = lifecycle.capabilities(binding.type).copy;
  if (copy === "unavailable") {
    diagnostics.push(diagnostic(
      "MOJO_PUBLIC_RUNTIME_VALUE_COPY_UNAVAILABLE",
      `Public runtime value '${binding.sourceName}' cannot leave module storage because its exact Mojo carrier is not copyable.`,
      binding.declaration,
    ));
    return undefined;
  }
  return Object.freeze({ kind: "value", copy });
}

function collectionElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (type.kind === "list") return type.element;
  if (type.kind !== "target-named" || type.id !== "tsonic.mojo.js.JsArray") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}
