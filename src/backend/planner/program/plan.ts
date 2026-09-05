import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan, MojoOutputSourceFile } from "../../artifact-model/project/output.js";
import type {
  MojoDeclaration,
} from "../../target-ast/index.js";
import {
  createMojoPlanningContext,
} from "./context.js";
import type {
  MojoOutputPlanningContext,
} from "./context.js";
import type {
  MojoTargetProgram,
} from "../../../analysis/program/model.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import { planMojoModuleState } from "./module-state.js";
import { planMojoPublicModuleExports } from "./public-exports.js";
import { planMojoInterface } from "../declarations/interfaces.js";
import {
  planMojoPolymorphicInterface,
  planMojoPolymorphicProjectClass,
} from "../objects/polymorphism/index.js";
import {
  planMojoProjectClass,
  planMojoProjectEnum,
  planMojoProjectFunctionVariants,
  planMojoProjectTypeAlias,
} from "../declarations/project.js";
import { planMojoPhysicalTypeAliases } from "../types/aliases.js";
import { normalizeMojoDeclarations } from "../../normalization/index.js";
import { createMojoOutputComponents } from "../../artifact-model/project/components.js";
import { createMojoNativeBuildPlan } from "../../artifact-model/project/native.js";
import { planMojoTopLevelImplementationAdapter } from "../callables/implementation-adapters.js";
import { planPackageInitializers } from "./package-initializers.js";
import { planBinaryEntry } from "./binary-entry.js";
import {
  duplicateMojoSourcePaths,
  mojoOutputPlanningDiagnostic,
  sortedMojoImports,
} from "./plan-support.js";

export function planMojoOutput(
  input: MojoOutputPlanningContext,
): TargetStageResult<MojoOutputPlan> {
  const { program } = input;
  const diagnostics: TargetDiagnostic[] = [];
  const sources: MojoOutputSourceFile[] = [];
  for (const module of program.modules.definitions) {
    const planned = planSourceModule(program, module);
    if (planned.kind === "rejected") diagnostics.push(...planned.diagnostics);
    else sources.push(planned.source);
  }
  const packageLayout = planPackageInitializers(program, sources, diagnostics);
  sources.splice(0, sources.length, ...packageLayout.sources);
  if (program.configuration.outputType === "bin") {
    const main = planBinaryEntry(program, diagnostics);
    if (main !== undefined) sources.push(main);
  }
  const duplicatePaths = duplicateMojoSourcePaths(sources);
  for (const path of duplicatePaths) {
    diagnostics.push(mojoOutputPlanningDiagnostic(
      "MOJO_OUTPUT_SOURCE_PATH_CONFLICT",
      `Multiple sealed Mojo source modules map to output path '${path}'.`,
    ));
  }
  if (diagnostics.length > 0) return rejectedTargetStage(Object.freeze(diagnostics));
  const orderedSources = Object.freeze([...sources].sort((left, right) =>
    left.path.localeCompare(right.path, "en")));
  return resolvedTargetStage(Object.freeze({
    configuration: program.configuration,
    components: createMojoOutputComponents(
      program.modules.packages,
      orderedSources,
      program.runtimePackages,
      program.configuration,
      packageLayout.initializers,
    ),
    sources: orderedSources,
    runtimePackages: program.runtimePackages,
    nativeBuild: createMojoNativeBuildPlan(program.runtimePackages),
  }));
}

function planSourceModule(
  program: MojoTargetProgram,
  module: MojoSourceModuleDefinition,
):
  | { readonly kind: "resolved"; readonly source: MojoOutputSourceFile }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const context = createMojoPlanningContext(program, module);
  const declarations: MojoDeclaration[] = [];
  const analyzedModule = program.queries.moduleForId(module.id);
  if (analyzedModule === undefined) {
    context.diagnostics.push(mojoOutputPlanningDiagnostic(
      "MOJO_ANALYZED_MODULE_MISSING",
      `Source module '${module.relativeSourcePath}' has no sealed target analysis.`,
      module.sourceFile,
    ));
  } else {
    const stateDiagnosticCount = context.diagnostics.length;
    const state = planMojoModuleState(program, module, analyzedModule, context);
    if (state !== undefined) {
      declarations.push(...state);
      const publicExports = planMojoPublicModuleExports(program, module, context);
      if (publicExports !== undefined) declarations.push(...publicExports);
    } else if (context.diagnostics.length === stateDiagnosticCount) {
      context.diagnostics.push(mojoOutputPlanningDiagnostic(
        "MOJO_MODULE_STATE_NOT_PLANNED",
        `Source module '${module.relativeSourcePath}' has no exact sealed module-state plan.`,
        module.sourceFile,
      ));
    }
  }
  for (const adapter of program.callableImplementationAdapters) {
    if (adapter.kind !== "top-level-function-overload") continue;
    if (program.modules.forSourceFile(adapter.sourceFile)?.id !== module.id) continue;
    const diagnosticCount = context.diagnostics.length;
    const planned = planMojoTopLevelImplementationAdapter(adapter, context);
    if (planned !== undefined) {
      declarations.push(planned);
    } else if (context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(mojoOutputPlanningDiagnostic(
        "MOJO_SEALED_CALLABLE_ADAPTER_PLAN_MISSING",
        `Sealed overload adapter '${adapter.name}' has no mechanical Mojo declaration plan.`,
        adapter.contract.declaration,
      ));
    }
  }
  for (const declaration of program.declarations) {
    if (program.modules.forSourceFile(declaration.sourceFile)?.id !== module.id) continue;
    if (declaration.kind === "class") {
      const diagnosticCount = context.diagnostics.length;
      const planned = declaration.polymorphic
        ? planMojoPolymorphicProjectClass(declaration, context)
        : planMojoProjectClass(declaration, context);
      if (planned !== undefined) {
        declarations.push(...planned);
      } else if (context.diagnostics.length === diagnosticCount) {
        context.diagnostics.push(mojoOutputPlanningDiagnostic(
          "MOJO_PROJECT_CLASS_NOT_PLANNED",
          `Project class '${declaration.name}' has no exact sealed Mojo declaration plan.`,
          declaration.declaration,
        ));
      }
      continue;
    }
    if (declaration.kind === "enum") {
      declarations.push(planMojoProjectEnum(declaration));
      continue;
    }
    if (declaration.kind === "interface") {
      if (!declaration.polymorphic) {
        declarations.push(...planMojoInterface(declaration, context));
        continue;
      }
      const diagnosticCount = context.diagnostics.length;
      const planned = planMojoPolymorphicInterface(declaration, context);
      if (planned !== undefined) {
        declarations.push(...planned);
      } else if (context.diagnostics.length === diagnosticCount) {
        context.diagnostics.push(mojoOutputPlanningDiagnostic(
          "MOJO_PROJECT_INTERFACE_NOT_PLANNED",
          `Project interface '${declaration.name}' has no exact sealed Mojo declaration plan.`,
          declaration.declaration,
        ));
      }
      continue;
    }
    if (declaration.kind === "type-alias") {
      declarations.push(planMojoProjectTypeAlias(declaration, context));
      continue;
    }
    const diagnosticCount = context.diagnostics.length;
    const planned = planMojoProjectFunctionVariants(declaration, context);
    if (planned !== undefined) {
      declarations.push(...planned);
    } else if (context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(mojoOutputPlanningDiagnostic(
        "MOJO_PROJECT_FUNCTION_NOT_PLANNED",
        `Project function '${declaration.name}' has no exact sealed Mojo declaration plan.`,
        declaration.declaration,
      ));
    }
  }
  if (context.diagnostics.length > 0) {
    return Object.freeze({ kind: "rejected", diagnostics: Object.freeze(context.diagnostics) });
  }
  const plannedDeclarations = normalizeMojoDeclarations([
    ...declarations,
    ...context.syntheticDeclarations,
  ]);
  const physicalTypeAliases = planMojoPhysicalTypeAliases(plannedDeclarations, context);
  return Object.freeze({
    kind: "resolved",
    source: Object.freeze({
      componentId: module.componentId,
      path: module.artifactPath,
      module: Object.freeze({
        modulePath: module.modulePath,
        imports: sortedMojoImports(context.imports.values()),
        typeAliases: Object.freeze([...context.typeAliases.values()].sort((left, right) =>
          left.typeKey.localeCompare(right.typeKey, "en"))),
        declarations: Object.freeze([...physicalTypeAliases, ...plannedDeclarations]),
      }),
    }),
  });
}
