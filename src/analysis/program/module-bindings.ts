import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type { MojoSourceModuleCatalog } from "../modules/model.js";
import type { MojoProjectTypeCatalog } from "../types/project-catalog.js";
import { resolveMojoTargetType } from "../types/resolution.js";
import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
} from "./model.js";

export interface MojoModuleBindingAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly modules: MojoSourceModuleCatalog;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly jsEnabled: boolean;
  readonly diagnostics: TargetDiagnostic[];
  readonly allocateModuleName: (sourceFile: SourceFile, name: string) => string;
  readonly bindName: (declaration: Node, name: string) => void;
  readonly bindSourceFile: (declaration: Node, sourceFile: SourceFile) => void;
  readonly bindType: (declaration: Node, type: MojoTargetTypeRef) => void;
}

export function analyzeMojoModuleBindings(
  input: MojoModuleBindingAnalysisInput,
): readonly MojoAnalyzedModule[] {
  const analyzed: MojoAnalyzedModule[] = [];
  const { ast } = input.source;
  for (const sourceFile of input.sourceFiles) {
    const definition = input.modules.forSourceFile(sourceFile);
    if (definition === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_MODULE_BINDING_OWNER_MISSING",
        "Top-level source bindings require one exact sealed Mojo module owner.",
        sourceFile,
      ));
      continue;
    }
    const semantics = input.source.semantics.forFile(sourceFile);
    const bindings: MojoAnalyzedModuleBinding[] = [];
    const executableStatements: Node[] = [];
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) {
        input.diagnostics.push(diagnostic(
          "MOJO_MODULE_STATEMENT_EVIDENCE_INCOMPLETE",
          "A project source module contains an undefined top-level statement slot.",
          sourceFile,
        ));
        continue;
      }
      if (ast.is.IsVariableStatement(statement)) {
        const declarationKind = ast.variableDeclarationKind(statement);
        if (declarationKind !== "const" && declarationKind !== "let" && declarationKind !== "var") {
          input.diagnostics.push(diagnostic(
            "MOJO_MODULE_RESOURCE_BINDING_REQUIRES_RESOURCE_PLAN",
            `Top-level '${declarationKind ?? "unknown"}' declarations require the sealed Mojo resource-lifetime plan.`,
            statement,
          ));
          continue;
        }
        const declarations = VariableDeclarationList_Declarations(
          ast,
          VariableStatement_DeclarationList(ast, statement),
        );
        if (declarations === undefined || declarations.length === 0 ||
          declarations.some((declaration) => declaration === undefined)) {
          input.diagnostics.push(diagnostic(
            "MOJO_MODULE_BINDING_EVIDENCE_INCOMPLETE",
            "A top-level variable statement requires a dense declaration list.",
            statement,
          ));
          continue;
        }
        let runtimeStatement = false;
        for (const declaration of declarations as readonly Node[]) {
          const nameNode = ast.name(declaration);
          if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
            input.diagnostics.push(diagnostic(
              "MOJO_MODULE_BINDING_PATTERN_UNSUPPORTED",
              "Top-level destructuring requires the sealed binding-pattern plan.",
              declaration,
            ));
            continue;
          }
          const initializer = Node_Initializer(ast, declaration);
          const authoredTypeNode = ast.typeNode(declaration);
          const selectedType = semantics.declarations.declaredValueType(declaration) ??
            semantics.declarations.declaredType(declaration) ??
            (authoredTypeNode === undefined
              ? undefined
              : semantics.types.authoredType(authoredTypeNode)) ??
            (initializer === undefined ? undefined : semantics.types.expressionType(initializer));
          const resolved = resolveMojoTargetType(
            selectedType,
            authoredTypeNode,
            {
              ast,
              semantics,
              sourceFacts: input.source.sourceFacts,
              providerSemantics: input.providerSemantics,
              projectTypes: input.projectTypes,
              jsEnabled: input.jsEnabled,
            },
          );
          if (resolved.kind === "unsupported") {
            input.diagnostics.push(diagnostic(
              "MOJO_TARGET_TYPE_UNSUPPORTED",
              `Selected top-level binding type cannot be represented exactly in Mojo: ${resolved.reason}.`,
              declaration,
            ));
            continue;
          }
          const sourceName = ast.text(nameNode);
          const name = input.allocateModuleName(sourceFile, sourceName);
          const storage = declarationKind === "const" && initializer !== undefined &&
              isNativeComptimeInitializer(initializer, resolved.type, input.source)
            ? "comptime"
            : "cell";
          const binding = Object.freeze({
            declaration,
            sourceFile,
            sourceName,
            name,
            declarationKind,
            storage,
            type: resolved.type,
            ...(initializer === undefined ? {} : { initializer }),
          }) satisfies MojoAnalyzedModuleBinding;
          bindings.push(binding);
          input.bindName(declaration, name);
          input.bindSourceFile(declaration, sourceFile);
          input.bindType(declaration, resolved.type);
          runtimeStatement = runtimeStatement || storage === "cell";
        }
        if (runtimeStatement) executableStatements.push(statement);
        continue;
      }
      if (ast.is.IsExpressionStatement(statement)) {
        if (Node_Expression(ast, statement) !== undefined) executableStatements.push(statement);
        continue;
      }
      if (ast.is.IsExportAssignment(statement)) {
        const initializer = Node_Expression(ast, statement);
        const selectedType = initializer === undefined ? undefined : semantics.types.expressionType(initializer);
        const resolved = resolveMojoTargetType(
          selectedType,
          undefined,
          {
            ast,
            semantics,
            sourceFacts: input.source.sourceFacts,
            providerSemantics: input.providerSemantics,
            projectTypes: input.projectTypes,
            jsEnabled: input.jsEnabled,
          },
        );
        if (initializer === undefined) {
          input.diagnostics.push(diagnostic(
            "MOJO_DEFAULT_EXPORT_CARRIER_UNRESOLVED",
            "A default export assignment requires one exact source expression.",
            statement,
          ));
          continue;
        }
        if (resolved.kind === "unsupported") {
          input.diagnostics.push(diagnostic(
            "MOJO_DEFAULT_EXPORT_CARRIER_UNRESOLVED",
            `A default export expression has no exact Mojo carrier: ${resolved.reason}.`,
            statement,
          ));
          continue;
        }
        const name = input.allocateModuleName(sourceFile, "defaultExport");
        const binding = Object.freeze({
          declaration: statement,
          sourceFile,
          sourceName: "default",
          name,
          declarationKind: "const" as const,
          storage: "cell" as const,
          type: resolved.type,
          initializer,
        });
        bindings.push(binding);
        input.bindName(statement, name);
        input.bindSourceFile(statement, sourceFile);
        input.bindType(statement, resolved.type);
        executableStatements.push(statement);
      }
    }
    analyzed.push(Object.freeze({
      sourceFile,
      stateName: input.allocateModuleName(sourceFile, "TsonicModuleState"),
      createStateName: input.allocateModuleName(sourceFile, "createTsonicModuleState"),
      cellName: input.allocateModuleName(sourceFile, "tsonicModuleState"),
      initializeName: input.allocateModuleName(sourceFile, "initializeTsonicModule"),
      bindings: Object.freeze(bindings),
      executableStatements: Object.freeze(executableStatements),
      asynchronous: definition.topLevelAwait,
      runtimeInitializationRequired: executableStatements.length > 0,
    }));
  }
  return Object.freeze(analyzed);
}

function isNativeComptimeInitializer(
  initializer: Node,
  type: MojoTargetTypeRef,
  source: TargetSourceProgram,
): boolean {
  const kind = source.ast.kindName(initializer);
  if (type.kind === "source-primitive" && type.name === "bool") {
    return kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
  }
  if (type.kind !== "source-primitive" || type.name === "char") return false;
  if (kind === "KindNumericLiteral") return true;
  if (!source.ast.is.IsPrefixUnaryExpression(initializer)) return false;
  const operand = source.ast.as.AsPrefixUnaryExpression(initializer)?.Operand;
  const operator = source.ast.operatorKindName(initializer);
  return operand !== undefined && source.ast.is.IsNumericLiteral(operand) &&
    (operator === "KindPlusToken" || operator === "KindMinusToken");
}

function diagnostic(code: string, message: string, node: Node): TargetDiagnostic {
  return mojoAnalysisDiagnostic(code, message, node);
}
