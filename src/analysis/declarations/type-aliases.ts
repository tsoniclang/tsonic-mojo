import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoTypeParameters } from "../callables/signatures.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type { MojoAnalyzedTypeAlias } from "../program/model.js";

export function analyzeMojoTypeAlias(input: {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly lifecycle: MojoLifecycleResolver;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly exported: boolean;
  readonly diagnostics: TargetDiagnostic[];
}): MojoAnalyzedTypeAlias | undefined {
  const { ast } = input.source;
  const typeNode = ast.typeNode(input.declaration);
  if (typeNode === undefined) {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_TYPE_ALIAS_TARGET_MISSING",
      "A Mojo type alias requires one exact authored target type.",
      input.declaration,
    ));
    return undefined;
  }
  const typeParameters = analyzeMojoTypeParameters(input);
  if (typeParameters === undefined) return undefined;
  const semantics = input.source.semantics.forFile(input.sourceFile);
  const selectedType = semantics.types.authoredType(typeNode) ??
    semantics.declarations.declaredType(input.declaration);
  const resolved = resolveMojoTargetType(selectedType, typeNode, {
    ast,
    semantics,
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
  });
  if (resolved.kind === "unsupported") {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_TYPE_ALIAS_TARGET_UNSUPPORTED",
      `Type alias target cannot be represented exactly in Mojo: ${resolved.reason}.`,
      typeNode,
    ));
    return undefined;
  }
  const id = sourceNodeIdentity(ast, input.declaration);
  if (id === undefined) {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_TYPE_ALIAS_IDENTITY_UNRESOLVED",
      "A Mojo type alias requires one stable source declaration identity.",
      input.declaration,
    ));
    return undefined;
  }
  return Object.freeze({
    kind: "type-alias",
    id,
    declaration: input.declaration,
    sourceFile: input.sourceFile,
    name: input.name,
    typeParameters,
    value: resolved.type,
    exported: input.exported,
  });
}
