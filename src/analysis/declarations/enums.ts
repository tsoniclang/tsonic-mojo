import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedEnum,
  MojoAnalyzedEnumMember,
} from "../program/model.js";

export interface MojoEnumAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly allocateMemberName: (name: string) => string;
  readonly bindName: (declaration: Node, name: string) => void;
  readonly diagnostics: TargetDiagnostic[];
}

export function analyzeMojoEnum(
  input: MojoEnumAnalysisInput,
): MojoAnalyzedEnum | undefined {
  const definition = input.projectTypes.definitionForDeclaration(input.declaration);
  const targetType = definition?.kind === "enum"
    ? input.projectTypes.targetTypeForDefinition(definition, Object.freeze([]))
    : undefined;
  if (targetType === undefined) {
    append(input, "MOJO_ENUM_IDENTITY_UNRESOLVED", "Enum lowering requires one exact project-enum identity.", input.declaration);
    return undefined;
  }
  const members = input.source.ast.members(input.declaration);
  if (members.some((member) => member === undefined)) {
    append(input, "MOJO_ENUM_MEMBER_EVIDENCE_INCOMPLETE", "Enum lowering requires a dense member list.", input.declaration);
    return undefined;
  }
  const analyzed: MojoAnalyzedEnumMember[] = [];
  const semantics = input.source.semantics.forFile(input.sourceFile);
  for (const member of members as readonly Node[]) {
    if (!input.source.ast.is.IsEnumMember(member)) {
      append(input, "MOJO_ENUM_MEMBER_SHAPE_UNSUPPORTED", "Enum declarations may contain only exact enum members.", member);
      continue;
    }
    const nameNode = input.source.ast.name(member);
    if (nameNode === undefined || !input.source.ast.is.IsIdentifier(nameNode)) {
      append(input, "MOJO_ENUM_MEMBER_NAME_UNSUPPORTED", "Enum members require one exact identifier name.", member);
      continue;
    }
    const value = semantics.types.constantValue(member);
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      append(
        input,
        "MOJO_ENUM_MEMBER_CONSTANT_UNSUPPORTED",
        "Enum members require one checker-evaluated safe integer discriminant.",
        member,
      );
      continue;
    }
    const sourceName = input.source.ast.text(nameNode);
    const name = input.allocateMemberName(sourceName);
    input.bindName(member, name);
    analyzed.push(Object.freeze({
      kind: "enum-member",
      declaration: member,
      sourceName,
      name,
      value,
      owner: targetType,
    }));
  }
  if (analyzed.length !== members.length) return undefined;
  return Object.freeze({
    kind: "enum",
    declaration: input.declaration,
    sourceFile: input.sourceFile,
    name: input.name,
    targetType,
    members: Object.freeze(analyzed),
  });
}

function append(
  input: MojoEnumAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
