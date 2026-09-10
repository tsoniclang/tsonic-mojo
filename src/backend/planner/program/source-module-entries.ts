import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetProgram } from "../../../analysis/program/model.js";
import type { MojoExpression, MojoSourceModule, MojoStatement } from "../../target-ast/index.js";
import { mojoOutputPlanningDiagnostic } from "./plan-support.js";

export function planMojoSourceModuleEntries(
  program: MojoTargetProgram,
  diagnostics: TargetDiagnostic[],
): { readonly imports: MojoSourceModule["imports"]; readonly statements: readonly MojoStatement[] } {
  const imports: MojoSourceModule["imports"][number][] = [];
  const statements: MojoStatement[] = [];
  const bootstraps = new Map(program.sourceModuleConstructions.map((entry) => [entry.bootstrap.id, entry.bootstrap]));
  let ordinal = 0;
  for (const bootstrap of bootstraps.values()) {
    const providerAlias = `_module_runtime_${ordinal}`;
    const entryName = `_module_entry_${ordinal}`;
    ordinal += 1;
    imports.push({ kind: "module", modulePath: bootstrap.modulePath, alias: providerAlias });
    statements.push({ kind: "variable", name: entryName, initializer: invoke(`${providerAlias}.${bootstrap.entryName}`) });
    const dispatch: MojoStatement[] = [];
    const entryValue: MojoExpression = { kind: "method-call", receiver: path(entryName), name: "value", arguments: [] };
    for (const entry of program.sourceModuleConstructions) {
      if (entry.bootstrap.id !== bootstrap.id) continue;
      const sourceModule = program.modules.forSourceFile(entry.sourceFile);
      const component = sourceModule === undefined ? undefined : program.moduleInitialization.componentForModuleId(sourceModule.id);
      const owner = component === undefined ? undefined : program.queries.moduleForId(component.ownerModuleId);
      const ownerModule = owner === undefined ? undefined : program.modules.forSourceFile(owner.sourceFile);
      if (component === undefined || owner === undefined || ownerModule === undefined) {
        diagnostics.push(mojoOutputPlanningDiagnostic("MOJO_SOURCE_MODULE_INITIALIZER_MISSING", "A sealed source-module entry has no exact module initializer.", entry.sourceFile));
        continue;
      }
      const body: MojoStatement[] = [];
      if (component.runtimeInitializationRequired) {
        const initializer = `_module_initialize_${ordinal}`;
        ordinal += 1;
        imports.push({ kind: "symbols", modulePath: ownerModule.modulePath, symbols: [{ name: owner.initializeName, alias: initializer }] });
        let expression = invoke(initializer);
        if (component.asynchronous) {
          const factory = component.raises ? "create_raising_task" : "create_task";
          const taskAlias = `_module_task_${ordinal}`;
          ordinal += 1;
          imports.push({ kind: "symbols", modulePath: ["tsonic_runtime"], symbols: [{ name: factory, alias: taskAlias }] });
          expression = { kind: "method-call", receiver: invoke(taskAlias, [expression]), name: "wait", arguments: [] };
        }
        body.push({ kind: "expression", expression });
      }
      for (const [index, epilogue] of program.binaryEpilogues.entries()) {
        const epilogueAlias = `_module_drain_${ordinal}_${index}`;
        imports.push({ kind: "symbols", modulePath: epilogue.modulePath, symbols: [{ name: epilogue.name, alias: epilogueAlias }] });
        body.push({ kind: "expression", expression: invoke(epilogueAlias) });
      }
      ordinal += 1;
      const finish = (success: boolean, message: MojoExpression): MojoStatement => ({
        kind: "expression", expression: invoke(`${providerAlias}.${bootstrap.completeName}`, [{ kind: "bool-literal", value: success }, message]),
      });
      const errorName = `_module_error_${ordinal}`;
      dispatch.push({
        kind: "if",
        condition: { kind: "binary", operator: "==", left: entryValue, right: { kind: "string-literal", value: entry.identity }, evaluation: "read-only" },
        thenStatements: [
          { kind: "try", statements: body, catches: [{ name: errorName, statements: [finish(false, invoke("String", [path(errorName)])), { kind: "return" }] }] },
          finish(true, { kind: "string-literal", value: "" }),
          { kind: "return" },
        ],
      });
    }
    dispatch.push({ kind: "raise", expression: invoke("Error", [{ kind: "string-literal", value: "Requested source module has no compiled entry in this executable" }]) });
    statements.push({ kind: "if", condition: invoke("Bool", [path(entryName)]), thenStatements: dispatch });
  }
  return Object.freeze({ imports: Object.freeze(imports), statements: Object.freeze(statements) });
}

function path(name: string): MojoExpression {
  return { kind: "path", path: name };
}

function invoke(name: string, values: readonly MojoExpression[] = []): MojoExpression {
  return { kind: "call", callee: path(name), arguments: values.map((value) => ({ value })) };
}
