import type {
  Node,
  SourceAnalysisContext,
} from "@tsonic/tsts";
import {
  forEachSelectedProviderSourceCall,
  selectedProviderCallMatches,
} from "@tsonic/source-core/extension";
import type {
  SelectedProviderSourceCall,
  TsonicSourceFileAnalysisContext,
} from "@tsonic/source-core/extension";
import {
  mojoLangModule,
  mojoSourceProviderVersion,
  mojoSourceSemanticsExtensionId,
  mojoSourceVirtualModulesProviderId,
} from "../identity.js";
import {
  mojoSourceOperationNames,
  mojoSourceOperationSignatureIds,
} from "../declarations/operations.js";
import {
  mojoSourceValueOperationFactKey,
  type MojoSourceValueOperationFact,
} from "../facts/operations.js";

export function analyzeMojoSourceValueOperations(context: SourceAnalysisContext): void {
  forEachSelectedProviderSourceCall(context, (selected, sourceContext): void => {
    const kind = selectedOperationKind(selected, sourceContext);
    if (kind === undefined) {
      return;
    }
    const argument = selected.selection.sourceArguments[0];
    if (argument === undefined) {
      appendDiagnostic(
        sourceContext,
        selected.call,
        "MOJO_SOURCE_VALUE_OPERATION_EVIDENCE_MISSING",
        9_500_010,
        `The selected Mojo ${kind} operation is missing its exact value evidence.`,
      );
      return;
    }
    const fact = Object.freeze({
      kind,
      expression: argument.expression,
      sourceType: argument.type,
      resultType: selected.selection.sourceResultType,
    });
    const result = sourceContext.facts.set(
      selected.call,
      mojoSourceValueOperationFactKey,
      fact,
      [{ message: `Mojo ${kind} intent derived from one exact selected target-source call.` }],
    );
    if (result !== "inserted" && result !== "idempotent") {
      appendDiagnostic(
        sourceContext,
        selected.call,
        "MOJO_SOURCE_VALUE_OPERATION_FACT_WRITE_FAILED",
        9_500_011,
        `The selected Mojo ${kind} fact could not be recorded (${result}).`,
      );
    }
  });
}

function selectedOperationKind(
  selected: SelectedProviderSourceCall,
  context: TsonicSourceFileAnalysisContext,
): MojoSourceValueOperationFact["kind"] | undefined {
  const operations = [
    [mojoSourceOperationNames.copyExport, mojoSourceOperationSignatureIds.copy, "copy"],
    [mojoSourceOperationNames.materializeExport, mojoSourceOperationSignatureIds.materialize, "materialize"],
  ] as const;
  for (const [exportId, signatureId, kind] of operations) {
    if (selectedProviderCallMatches(selected, {
      kind: "export-signature",
      providerId: mojoSourceVirtualModulesProviderId,
      providerVersion: mojoSourceProviderVersion,
      providerModuleId: mojoLangModule,
      exportId,
      signatureId,
    }, context)) {
      return kind;
    }
  }
  return undefined;
}

function appendDiagnostic(
  context: TsonicSourceFileAnalysisContext,
  node: Node,
  extensionCode: string,
  numericCode: number,
  message: string,
): void {
  context.diagnostics.append({
    extensionId: mojoSourceSemanticsExtensionId,
    extensionCode,
    numericCode,
    publicCode: `TSONIC_MOJO_${numericCode}`,
    category: "error",
    message,
    nodeOrSpan: node,
    identity: [
      "mojo-source-value-operation",
      extensionCode,
      context.ast.getPath(context.ast.getSourceFile(node)),
      context.ast.pos(node),
      context.ast.end(node),
    ].join(":"),
  });
}
