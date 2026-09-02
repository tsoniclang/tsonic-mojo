import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";

export interface MojoFunctionDraft {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly body: Node;
  readonly localNames: (sourceName: string) => string;
}

export interface MojoNamedTypeDraft {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
}

export interface MojoEnumDraft {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
}

export interface MojoDeclarationDrafts {
  readonly functions: readonly MojoFunctionDraft[];
  readonly classes: readonly MojoNamedTypeDraft[];
  readonly interfaces: readonly MojoNamedTypeDraft[];
  readonly enums: readonly MojoEnumDraft[];
}

export function collectMojoDeclarationDrafts(input: {
  readonly sourceFiles: readonly SourceFile[];
  readonly ast: TargetSourceProgram["ast"];
  readonly globalNameByDeclaration: WeakMap<Node, string>;
  readonly globalNames: (sourceFile: SourceFile) => (name: string) => string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly createNameAllocator: () => (name: string) => string;
  readonly diagnostics: TargetDiagnostic[];
}): MojoDeclarationDrafts {
  const functions: MojoFunctionDraft[] = [];
  const classes: MojoNamedTypeDraft[] = [];
  const interfaces: MojoNamedTypeDraft[] = [];
  const enums: MojoEnumDraft[] = [];
  const { ast } = input;
  for (const sourceFile of input.sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined || ignoredTopLevel(statement, ast)) continue;
      const nameNode = ast.name(statement);
      if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
        reject(input, declarationShapeCode(statement, ast), declarationShapeMessage(statement, ast), statement);
        continue;
      }
      const name = input.globalNameByDeclaration.get(statement) ??
        input.globalNames(sourceFile)(ast.text(nameNode));
      input.bindingNames.set(statement, name);
      input.bindingSourceFiles.set(statement, sourceFile);
      if (ast.is.IsClassDeclaration(statement)) {
        classes.push(namedTypeDraft(statement, sourceFile, name, input.globalNames));
      } else if (ast.is.IsInterfaceDeclaration(statement)) {
        interfaces.push(namedTypeDraft(statement, sourceFile, name, input.globalNames));
      } else if (ast.is.IsEnumDeclaration(statement)) {
        enums.push(Object.freeze({ declaration: statement, sourceFile, name }));
      } else if (ast.is.IsFunctionDeclaration(statement)) {
        const body = ast.body(statement);
        if (body === undefined || !ast.is.IsBlock(body)) {
          reject(input, "MOJO_FUNCTION_SHAPE_UNSUPPORTED", "Mojo functions require a named TypeScript function declaration with a body.", statement);
        } else {
          functions.push(Object.freeze({
            declaration: statement,
            sourceFile,
            name,
            body,
            localNames: input.createNameAllocator(),
          }));
        }
      } else {
        reject(input, "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED", "Executable project declarations require a supported top-level function, class, interface, or enum form.", statement);
      }
    }
  }
  return Object.freeze({
    functions: Object.freeze(functions),
    classes: Object.freeze(classes),
    interfaces: Object.freeze(interfaces),
    enums: Object.freeze(enums),
  });
}

function ignoredTopLevel(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsImportDeclaration(node) || ast.is.IsExportDeclaration(node) ||
    ast.is.IsTypeAliasDeclaration(node) || ast.is.IsVariableStatement(node) ||
    ast.is.IsExpressionStatement(node) || ast.is.IsExportAssignment(node) ||
    ast.is.IsEmptyStatement(node);
}

function namedTypeDraft(
  declaration: Node,
  sourceFile: SourceFile,
  name: string,
  globalNames: (sourceFile: SourceFile) => (name: string) => string,
): MojoNamedTypeDraft {
  return Object.freeze({
    declaration,
    sourceFile,
    name,
    stateName: globalNames(sourceFile)(`${name}State`),
  });
}

function declarationShapeCode(node: Node, ast: TargetSourceProgram["ast"]): string {
  if (ast.is.IsClassDeclaration(node)) return "MOJO_CLASS_SHAPE_UNSUPPORTED";
  if (ast.is.IsInterfaceDeclaration(node)) return "MOJO_INTERFACE_SHAPE_UNSUPPORTED";
  if (ast.is.IsEnumDeclaration(node)) return "MOJO_ENUM_SHAPE_UNSUPPORTED";
  if (ast.is.IsFunctionDeclaration(node)) return "MOJO_FUNCTION_SHAPE_UNSUPPORTED";
  return "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED";
}

function declarationShapeMessage(node: Node, ast: TargetSourceProgram["ast"]): string {
  if (ast.is.IsClassDeclaration(node)) return "Mojo classes require one exact named class declaration.";
  if (ast.is.IsInterfaceDeclaration(node)) return "Mojo project interfaces require one exact named interface declaration.";
  if (ast.is.IsEnumDeclaration(node)) return "Mojo enums require one exact named enum declaration.";
  if (ast.is.IsFunctionDeclaration(node)) return "Mojo functions require a named TypeScript function declaration with a body.";
  return "Executable project declarations require a supported top-level function, class, interface, or enum form.";
}

function reject(
  input: { readonly diagnostics: TargetDiagnostic[] },
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
