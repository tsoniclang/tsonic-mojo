import type {
  Node,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoProjectTypeCatalog,
  MojoProjectTypeDefinition,
  MojoProjectTypeIssue,
  MojoProjectTypeKind,
} from "../../target-model/types/project.js";

export function createMojoProjectTypeCatalog(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  nameForDeclaration: (declaration: Node, sourceName: string) => string,
  modulePathForSourceFile: (sourceFile: SourceFile) => readonly string[],
): MojoProjectTypeCatalog {
  const definitions: MojoProjectTypeDefinition[] = [];
  const issues: MojoProjectTypeIssue[] = [];
  const byDeclaration = new WeakMap<Node, MojoProjectTypeDefinition>();
  const byId = new Map<string, MojoProjectTypeDefinition>();
  const { ast } = source;

  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) continue;
      const kind = projectTypeKind(statement, ast);
      if (kind === undefined) continue;
      const nameNode = ast.name(statement);
      const identity = sourceNodeIdentity(ast, statement);
      if (nameNode === undefined || !ast.is.IsIdentifier(nameNode) || identity === undefined ||
        !source.navigation.isProjectDeclaration(statement)) {
        issues.push(Object.freeze({
          node: statement,
          code: "MOJO_PROJECT_TYPE_IDENTITY_UNRESOLVED",
          message: "Project type declarations require one named, project-owned source identity.",
        }));
        continue;
      }
      const rawParameters = kind === "enum" ? [] : ast.typeParameters(statement);
      if (rawParameters.some((parameter) => parameter === undefined)) {
        issues.push(Object.freeze({
          node: statement,
          code: "MOJO_PROJECT_TYPE_PARAMETER_INCOMPLETE",
          message: "Project type declarations require dense source type-parameter evidence.",
        }));
        continue;
      }
      const parameterNames = (rawParameters as readonly Node[]).map((parameter) => ast.name(parameter));
      if (parameterNames.some((parameter) => parameter === undefined || !ast.is.IsIdentifier(parameter))) {
        issues.push(Object.freeze({
          node: statement,
          code: "MOJO_PROJECT_TYPE_PARAMETER_UNNAMED",
          message: "Project type parameters require exact identifier declarations.",
        }));
        continue;
      }
      const sourceName = ast.text(nameNode);
      const definition = Object.freeze({
        id: `tsonic.mojo.project:${identity}`,
        declaration: statement,
        sourceFile,
        sourceName,
        targetName: nameForDeclaration(statement, sourceName),
        modulePath: Object.freeze([...modulePathForSourceFile(sourceFile)]),
        kind,
        typeParameterNames: Object.freeze((parameterNames as readonly Node[]).map((name) => ast.text(name))),
      });
      const existing = byId.get(definition.id);
      if (existing !== undefined && existing.declaration !== statement) {
        issues.push(Object.freeze({
          node: statement,
          code: "MOJO_PROJECT_TYPE_IDENTITY_CONFLICT",
          message: `Project type '${sourceName}' conflicts with another declaration at exact identity '${definition.id}'.`,
        }));
        continue;
      }
      definitions.push(definition);
      byDeclaration.set(statement, definition);
      byId.set(definition.id, definition);
    }
  }

  return Object.freeze({
    definitions: Object.freeze(definitions),
    issues: Object.freeze(issues),
    definitionForDeclaration(declaration: Node | undefined) {
      return declaration === undefined ? undefined : byDeclaration.get(declaration);
    },
    definitionForId(id: string) {
      return byId.get(id);
    },
    definitionForSymbol(
      symbol: Symbol | undefined,
      declarations: (symbol: Symbol) => readonly Node[],
    ) {
      if (symbol === undefined) return undefined;
      const matches = new Map<string, MojoProjectTypeDefinition>();
      for (const declaration of declarations(symbol)) {
        const definition = byDeclaration.get(declaration);
        if (definition !== undefined) matches.set(definition.id, definition);
      }
      return matches.size === 1 ? [...matches.values()][0] : undefined;
    },
    targetTypeForDefinition(
      definition: MojoProjectTypeDefinition,
      arguments_: readonly MojoTargetTypeRef[],
    ) {
      if (arguments_.length !== definition.typeParameterNames.length) return undefined;
      return Object.freeze({
        kind: "target-named" as const,
        id: definition.id,
        modulePath: definition.modulePath,
        name: definition.targetName,
        ...(arguments_.length === 0
          ? {}
          : {
              genericArguments: Object.freeze(arguments_.map((type: MojoTargetTypeRef) =>
                Object.freeze({ kind: "type" as const, type }))),
            }),
      });
    },
  });
}

function projectTypeKind(
  declaration: Node,
  ast: TargetSourceProgram["ast"],
): MojoProjectTypeKind | undefined {
  if (ast.is.IsClassDeclaration(declaration)) return "class";
  if (ast.is.IsInterfaceDeclaration(declaration)) return "interface";
  if (ast.is.IsEnumDeclaration(declaration)) return "enum";
  return undefined;
}
