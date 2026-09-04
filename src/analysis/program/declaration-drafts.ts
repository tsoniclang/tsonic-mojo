import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { isMojoModuleRuntimeStatement } from "./module-runtime-statements.js";

export interface MojoFunctionDraft {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly implementationAdapterName?: string;
  readonly body?: Node;
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

export interface MojoTypeAliasDraft {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
}

export interface MojoDeclarationDrafts {
  readonly functions: readonly MojoFunctionDraft[];
  readonly classes: readonly MojoNamedTypeDraft[];
  readonly interfaces: readonly MojoNamedTypeDraft[];
  readonly enums: readonly MojoEnumDraft[];
  readonly typeAliases: readonly MojoTypeAliasDraft[];
}

export function collectMojoDeclarationDrafts(input: {
  readonly sourceFiles: readonly SourceFile[];
  readonly ast: TargetSourceProgram["ast"];
  readonly globalNameByDeclaration: WeakMap<Node, string>;
  readonly globalNames: (sourceFile: SourceFile) => (
    name: string,
    role?: "value" | "type" | "constant",
  ) => string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly createNameAllocator: () => (name: string) => string;
  readonly diagnostics: TargetDiagnostic[];
}): MojoDeclarationDrafts {
  const functions: MojoFunctionDraft[] = [];
  const classes: MojoNamedTypeDraft[] = [];
  const interfaces: MojoNamedTypeDraft[] = [];
  const enums: MojoEnumDraft[] = [];
  const typeAliases: MojoTypeAliasDraft[] = [];
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
      } else if (ast.is.IsTypeAliasDeclaration(statement)) {
        typeAliases.push(Object.freeze({ declaration: statement, sourceFile, name }));
      } else if (ast.is.IsFunctionDeclaration(statement)) {
        const body = ast.body(statement);
        if (body !== undefined && !ast.is.IsBlock(body)) {
          reject(input, "MOJO_FUNCTION_BODY_INVALID", "A project function implementation requires one exact block body.", statement);
        } else {
          functions.push(Object.freeze({
            declaration: statement,
            sourceFile,
            name,
            ...(body === undefined
              ? { implementationAdapterName: input.globalNames(sourceFile)(`_${name}Overload`) }
              : {}),
            ...(body === undefined ? {} : { body }),
            localNames: input.createNameAllocator(),
          }));
        }
      } else {
        reject(input, "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED", "Executable project declarations require a supported top-level function, class, interface, enum, or type-alias form.", statement);
      }
    }
  }
  return Object.freeze({
    functions: Object.freeze(functions),
    classes: Object.freeze(classes),
    interfaces: Object.freeze(interfaces),
    enums: Object.freeze(enums),
    typeAliases: Object.freeze(typeAliases),
  });
}

function ignoredTopLevel(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsImportDeclaration(node) || ast.is.IsExportDeclaration(node) ||
    ast.is.IsVariableStatement(node) ||
    ast.is.IsExpressionStatement(node) || ast.is.IsExportAssignment(node) ||
    ast.is.IsEmptyStatement(node) || isMojoModuleRuntimeStatement(node, ast);
}

function namedTypeDraft(
  declaration: Node,
  sourceFile: SourceFile,
  name: string,
  globalNames: (sourceFile: SourceFile) => (
    name: string,
    role?: "value" | "type" | "constant",
  ) => string,
): MojoNamedTypeDraft {
  return Object.freeze({
    declaration,
    sourceFile,
    name,
    stateName: globalNames(sourceFile)(`_${name}State`, "type"),
  });
}

function declarationShapeCode(node: Node, ast: TargetSourceProgram["ast"]): string {
  if (ast.is.IsClassDeclaration(node)) return "MOJO_CLASS_SHAPE_UNSUPPORTED";
  if (ast.is.IsInterfaceDeclaration(node)) return "MOJO_INTERFACE_SHAPE_UNSUPPORTED";
  if (ast.is.IsEnumDeclaration(node)) return "MOJO_ENUM_SHAPE_UNSUPPORTED";
  if (ast.is.IsTypeAliasDeclaration(node)) return "MOJO_TYPE_ALIAS_SHAPE_UNSUPPORTED";
  if (ast.is.IsFunctionDeclaration(node)) return "MOJO_FUNCTION_NAME_INVALID";
  return "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED";
}

function declarationShapeMessage(node: Node, ast: TargetSourceProgram["ast"]): string {
  if (ast.is.IsClassDeclaration(node)) return "Mojo classes require one exact named class declaration.";
  if (ast.is.IsInterfaceDeclaration(node)) return "Mojo project interfaces require one exact named interface declaration.";
  if (ast.is.IsEnumDeclaration(node)) return "Mojo enums require one exact named enum declaration.";
  if (ast.is.IsTypeAliasDeclaration(node)) return "Mojo type aliases require one exact named alias declaration.";
  if (ast.is.IsFunctionDeclaration(node)) return "A project function requires one exact identifier name.";
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
