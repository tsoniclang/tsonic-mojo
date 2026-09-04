import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  ClassStaticBlock_Body,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import { classifyMojoBindingDisposition } from "../representations/index.js";
import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoModuleInitializationStep,
} from "./model.js";
import { isMojoModuleRuntimeStatement } from "./module-runtime-statements.js";
import { analyzeModuleBindingPattern, diagnostic, isExplicitCompileTimeInitializer } from "./module-binding-support.js";

export interface MojoModuleBindingAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly modules: MojoSourceModuleCatalog;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly diagnostics: TargetDiagnostic[];
  readonly allocateModuleName: (sourceFile: SourceFile, name: string) => string;
  readonly allocateModuleTypeName: (sourceFile: SourceFile, name: string) => string;
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
    const stateName = input.allocateModuleTypeName(sourceFile, "_ModuleState");
    const createStateName = input.allocateModuleName(sourceFile, "_createModuleState");
    const cellName = input.allocateModuleName(sourceFile, "_moduleState");
    const initializeName = input.allocateModuleName(sourceFile, "_initializeModule");
    const initializeBodyName = input.allocateModuleName(sourceFile, "_initializeModuleBody");
    const lifecycleLockName = input.allocateModuleName(sourceFile, "_lifecycleLock");
    const lifecycleInitializedName = input.allocateModuleName(sourceFile, "_lifecycleInitialized");
    const bindings: MojoAnalyzedModuleBinding[] = [];
    const initializationSteps: MojoModuleInitializationStep[] = [];
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
        if (declarationKind !== "const" && declarationKind !== "let" && declarationKind !== "var" &&
          declarationKind !== "using" && declarationKind !== "await using") {
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
        for (const declaration of declarations as readonly Node[]) {
          const nameNode = ast.name(declaration);
          if (nameNode !== undefined && (ast.is.IsArrayBindingPattern(nameNode) ||
            ast.is.IsObjectBindingPattern(nameNode))) {
            if (declarationKind === "using" || declarationKind === "await using") {
              input.diagnostics.push(diagnostic(
                "MOJO_MODULE_RESOURCE_BINDING_PATTERN_UNSUPPORTED",
                "Top-level resource management requires one exact resource binding rather than a destructured aggregate.",
                declaration,
              ));
              continue;
            }
            const pattern = analyzeModuleBindingPattern(
              declaration,
              nameNode,
              declarationKind,
              sourceFile,
              semantics,
              input,
            );
            if (pattern === undefined) continue;
            bindings.push(...pattern.bindings);
            initializationSteps.push(pattern);
            continue;
          }
          if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
            input.diagnostics.push(diagnostic(
              "MOJO_MODULE_BINDING_NAME_UNSUPPORTED",
              "A top-level binding requires one exact identifier or binding pattern.",
              declaration,
            ));
            continue;
          }
          const initializer = Node_Initializer(ast, declaration);
          if (initializer === undefined) {
            input.diagnostics.push(diagnostic(
              "MOJO_MODULE_BINDING_INITIALIZER_REQUIRED",
              "A runtime module binding requires an explicit initializer; Mojo cannot silently replace TypeScript undefined with a native default.",
              declaration,
            ));
            continue;
          }
          const authoredTypeNode = ast.typeNode(declaration);
          const selectedType = semantics.declarations.declaredValueType(declaration) ??
            semantics.declarations.declaredType(declaration) ??
            (authoredTypeNode === undefined
              ? undefined
              : semantics.types.authoredType(authoredTypeNode)) ??
            semantics.types.expressionType(initializer);
          const resolved = resolveMojoTargetType(
            selectedType,
            authoredTypeNode,
            {
              ast,
              navigation: input.source.navigation,
              semantics,
              sourceFacts: input.source.sourceFacts,
              providerSemantics: input.providerSemantics,
              projectTypes: input.projectTypes,
              sourceProfiles: input.sourceProfiles,
              jsEnabled: input.jsEnabled,
              ...(input.sourceCallableErrorType === undefined
                ? {}
                : { sourceCallableErrorType: input.sourceCallableErrorType }),
            },
          );
          if (resolved.kind === "unsupported") {
            input.diagnostics.push(diagnostic(
              "MOJO_MODULE_BINDING_CARRIER_UNRESOLVED",
              `Selected top-level binding type cannot be represented exactly in Mojo: ${resolved.reason}.`,
              declaration,
            ));
            continue;
          }
          const sourceName = ast.text(nameNode);
          const name = input.allocateModuleName(sourceFile, sourceName);
          const disposition = classifyMojoBindingDisposition({
            declaration,
            initializer,
            declarationKind,
            type: resolved.type,
            comptime: declarationKind === "const" &&
              isExplicitCompileTimeInitializer(initializer, input.source),
            source: input.source,
          });
          const binding = Object.freeze({
            kind: "module-binding" as const,
            declaration,
            sourceFile,
            sourceName,
            name,
            declarationKind,
            disposition,
            type: resolved.type,
            initializer,
          }) satisfies MojoAnalyzedModuleBinding;
          bindings.push(binding);
          input.bindName(declaration, name);
          input.bindSourceFile(declaration, sourceFile);
          input.bindType(declaration, resolved.type);
          if (disposition.kind === "immutable-runtime" || disposition.kind === "live-cell") {
            initializationSteps.push(Object.freeze({ kind: "binding", binding }));
          }
        }
        continue;
      }
      if (ast.is.IsExpressionStatement(statement)) {
        if (Node_Expression(ast, statement) !== undefined) {
          initializationSteps.push(Object.freeze({ kind: "statement", statement }));
        }
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
            navigation: input.source.navigation,
            semantics,
            sourceFacts: input.source.sourceFacts,
            providerSemantics: input.providerSemantics,
            projectTypes: input.projectTypes,
            sourceProfiles: input.sourceProfiles,
            jsEnabled: input.jsEnabled,
            ...(input.sourceCallableErrorType === undefined
              ? {}
              : { sourceCallableErrorType: input.sourceCallableErrorType }),
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
          kind: "module-binding" as const,
          declaration: statement,
          sourceFile,
          sourceName: "default",
          name,
          declarationKind: "const" as const,
          disposition: Object.freeze({ kind: "immutable-runtime" as const }),
          type: resolved.type,
          initializer,
        });
        bindings.push(binding);
        input.bindName(statement, name);
        input.bindSourceFile(statement, sourceFile);
        input.bindType(statement, resolved.type);
        initializationSteps.push(Object.freeze({ kind: "binding", binding }));
        continue;
      }
      if (ast.is.IsClassDeclaration(statement)) {
        const definition = input.projectTypes.definitionForDeclaration(statement);
        if (definition?.kind !== "class") {
          input.diagnostics.push(diagnostic(
            "MOJO_CLASS_STATIC_OWNER_UNRESOLVED",
            "Class static initialization requires one exact project-class owner.",
            statement,
          ));
          continue;
        }
        const members = ast.members(statement);
        if (members.some((member) => member === undefined)) {
          input.diagnostics.push(diagnostic(
            "MOJO_CLASS_STATIC_MEMBER_EVIDENCE_INCOMPLETE",
            "Class static initialization requires a dense member list.",
            statement,
          ));
          continue;
        }
        for (const member of members as readonly Node[]) {
          if (ast.is.IsPropertyDeclaration(member) && ast.hasModifierKind(member, "static")) {
            const nameNode = ast.name(member);
            const initializer = Node_Initializer(ast, member);
            if (nameNode === undefined ||
              (!ast.is.IsIdentifier(nameNode) && !ast.is.IsPrivateIdentifier(nameNode))) {
              input.diagnostics.push(diagnostic(
                "MOJO_CLASS_STATIC_FIELD_NAME_UNSUPPORTED",
                "Class static fields require one exact identifier or private-identifier name.",
                member,
              ));
              continue;
            }
            if (initializer === undefined) {
              input.diagnostics.push(diagnostic(
                "MOJO_CLASS_STATIC_FIELD_INITIALIZER_REQUIRED",
                "A class static field requires an explicit initializer; Mojo cannot silently replace TypeScript undefined with a native default.",
                member,
              ));
              continue;
            }
            const authoredTypeNode = ast.typeNode(member);
            const selectedType = semantics.declarations.declaredValueType(member) ??
              semantics.declarations.declaredType(member) ??
              (authoredTypeNode === undefined ? undefined : semantics.types.authoredType(authoredTypeNode)) ??
              semantics.types.expressionType(initializer);
            const resolved = resolveMojoTargetType(selectedType, authoredTypeNode, {
              ast,
              navigation: input.source.navigation,
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
              input.diagnostics.push(diagnostic(
                "MOJO_CLASS_STATIC_FIELD_CARRIER_UNRESOLVED",
                `Selected class static field type cannot be represented exactly in Mojo: ${resolved.reason}.`,
                member,
              ));
              continue;
            }
            const sourceName = ast.text(nameNode);
            const privateMember = ast.hasModifierKind(member, "private") ||
              ast.hasModifierKind(member, "protected") || ast.is.IsPrivateIdentifier(nameNode);
            const name = input.allocateModuleName(
              sourceFile,
              privateMember
                ? `_${definition.targetName}_${sourceName.replace(/^#/u, "")}`
                : `${definition.targetName}_${sourceName}`,
            );
            const binding = Object.freeze({
              kind: "class-static-field" as const,
              declaration: member,
              sourceFile,
              sourceName,
              name,
              declarationKind: "let" as const,
              disposition: classifyMojoBindingDisposition({
                declaration: member,
                initializer,
                declarationKind: "let",
                type: resolved.type,
                comptime: false,
                source: input.source,
              }),
              type: resolved.type,
              initializer,
            }) satisfies MojoAnalyzedModuleBinding;
            bindings.push(binding);
            input.bindName(member, name);
            input.bindSourceFile(member, sourceFile);
            input.bindType(member, resolved.type);
            initializationSteps.push(Object.freeze({ kind: "binding", binding }));
            continue;
          }
          if (ast.kindName(member) === "KindClassStaticBlockDeclaration") {
            const body = ClassStaticBlock_Body(ast, member);
            const statements = body === undefined ? undefined : ast.statements(body);
            if (body === undefined || statements === undefined ||
              statements.some((entry) => entry === undefined)) {
              input.diagnostics.push(diagnostic(
                "MOJO_CLASS_STATIC_BLOCK_EVIDENCE_INCOMPLETE",
                "A class static block requires one exact dense statement body.",
                member,
              ));
              continue;
            }
            if (statements.length > 0) {
              initializationSteps.push(Object.freeze({
                kind: "class-static-block",
                declaration: member,
                body,
                statements: Object.freeze(statements as readonly Node[]),
              }));
            }
          }
        }
        continue;
      }
      if (isMojoModuleRuntimeStatement(statement, ast)) {
        initializationSteps.push(Object.freeze({ kind: "statement", statement }));
      }
    }
    analyzed.push(Object.freeze({
      id: definition.id,
      sourceFile,
      stateName,
      createStateName,
      cellName,
      initializeName,
      initializeBodyName,
      lifecycleLockName,
      lifecycleInitializedName,
      bindings: Object.freeze(bindings),
      initializationSteps: Object.freeze(initializationSteps),
      asynchronous: definition.topLevelAwait,
      raises: false,
      directAsynchronous: definition.topLevelAwait,
      directRaises: false,
      directRuntimeInitializationRequired: initializationSteps.length > 0,
      initializationStateRequired: initializationSteps.length > 0,
      runtimeInitializationRequired: initializationSteps.length > 0,
    }));
  }
  return Object.freeze(analyzed);
}

export function finalizeMojoModuleBindingTypes(
  modules: readonly MojoAnalyzedModule[],
  bindingTypes: WeakMap<Node, MojoTargetTypeRef>,
): readonly MojoAnalyzedModule[] {
  return Object.freeze(modules.map((module) => {
    const bindings = Object.freeze(module.bindings.map((binding) => {
      const type = bindingTypes.get(binding.declaration) ?? binding.type;
      return type === binding.type ? binding : Object.freeze({ ...binding, type });
    }));
    const bindingByDeclaration = new Map(
      bindings.map((binding) => [binding.declaration, binding] as const),
    );
    const initializationSteps = Object.freeze(module.initializationSteps.map((step) => {
      if (step.kind === "binding") {
        return Object.freeze({
          kind: "binding" as const,
          binding: bindingByDeclaration.get(step.binding.declaration) ?? step.binding,
        });
      }
      if (step.kind !== "binding-pattern") return step;
      return Object.freeze({
        ...step,
        bindings: Object.freeze(step.bindings.map((binding) =>
          bindingByDeclaration.get(binding.declaration) ?? binding)),
      });
    }));
    return Object.freeze({ ...module, bindings, initializationSteps });
  }));
}
