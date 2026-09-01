import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoFunctionSignature } from "../callables/signatures.js";
import { analyzeMojoClass } from "../declarations/classes.js";
import { analyzeMojoEnum } from "../declarations/enums.js";
import { analyzeMojoInterface } from "../declarations/interfaces.js";
import { allocateMojoLocalBindings } from "./local-bindings.js";
import type { MojoDeclarationDrafts } from "./declaration-drafts.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedProjectProperty,
} from "./model.js";
import { closeMojoProjectStateStorage } from "./reference-storage.js";

export interface MojoProjectDeclarationAnalysis {
  readonly functions: MojoAnalyzedFunction[];
  readonly classes: MojoAnalyzedClass[];
  readonly interfaces: MojoAnalyzedInterface[];
  readonly enums: MojoAnalyzedEnum[];
  readonly functionByDeclaration: WeakMap<Node, MojoAnalyzedFunction>;
  readonly classByDeclaration: WeakMap<Node, MojoAnalyzedClass>;
  readonly classByTypeId: Map<string, MojoAnalyzedClass>;
  readonly interfaceByTypeId: Map<string, MojoAnalyzedInterface>;
}

export function analyzeMojoProjectDeclarations(input: {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly drafts: MojoDeclarationDrafts;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
  readonly createNameAllocator: () => (name: string) => string;
  readonly diagnostics: TargetDiagnostic[];
}): MojoProjectDeclarationAnalysis {
  const { ast } = input.source;
  const functions: MojoAnalyzedFunction[] = [];
  const classes: MojoAnalyzedClass[] = [];
  const interfaces: MojoAnalyzedInterface[] = [];
  const enums: MojoAnalyzedEnum[] = [];
  const functionByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  const classByDeclaration = new WeakMap<Node, MojoAnalyzedClass>();
  const classByTypeId = new Map<string, MojoAnalyzedClass>();
  const interfaceByTypeId = new Map<string, MojoAnalyzedInterface>();

  for (const draft of input.drafts.functions) {
    const function_ = analyzeMojoFunctionSignature({
      source: input.source,
      providerSemantics: input.providerSemantics,
      projectTypes: input.projectTypes,
      sourceProfiles: input.sourceProfiles,
      jsEnabled: input.jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      body: draft.body,
      allocateLocalName: draft.localNames,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      diagnostics: input.diagnostics,
    });
    if (function_ === undefined) continue;
    functions.push(function_);
    functionByDeclaration.set(draft.declaration, function_);
    for (const parameter of function_.parameters) {
      input.bindingSourceFiles.set(parameter.declaration, draft.sourceFile);
    }
    allocateMojoLocalBindings(
      draft.body,
      draft.localNames,
      input.bindingNames,
      ast,
      input.diagnostics,
      input.bindingSourceFiles,
    );
  }

  for (const draft of input.drafts.interfaces) {
    const analyzed = analyzeMojoInterface({
      source: input.source,
      providerSemantics: input.providerSemantics,
      projectTypes: input.projectTypes,
      sourceProfiles: input.sourceProfiles,
      jsEnabled: input.jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      stateName: draft.stateName,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      diagnostics: input.diagnostics,
      createNameAllocator: input.createNameAllocator,
    });
    if (analyzed === undefined) continue;
    interfaces.push(analyzed);
    input.bindingTypes.set(draft.declaration, analyzed.targetType);
    if (analyzed.targetType.kind === "target-named") {
      interfaceByTypeId.set(analyzed.targetType.id, analyzed);
    }
    for (const field of analyzed.fields) {
      input.bindingSourceFiles.set(field.declaration, draft.sourceFile);
      input.fieldByDeclaration.set(field.declaration, field);
    }
    for (const indexSignature of analyzed.indexSignatures) {
      input.bindingSourceFiles.set(indexSignature.declaration, draft.sourceFile);
      input.fieldByDeclaration.set(indexSignature.declaration, indexSignature);
    }
  }

  for (const draft of input.drafts.classes) {
    const analyzed = analyzeMojoClass({
      source: input.source,
      providerSemantics: input.providerSemantics,
      projectTypes: input.projectTypes,
      sourceProfiles: input.sourceProfiles,
      jsEnabled: input.jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      stateName: draft.stateName,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      diagnostics: input.diagnostics,
      createNameAllocator: input.createNameAllocator,
      allocateLocalBindings(body, allocate) {
        allocateMojoLocalBindings(
          body,
          allocate,
          input.bindingNames,
          ast,
          input.diagnostics,
          input.bindingSourceFiles,
        );
      },
    });
    if (analyzed === undefined) continue;
    for (const field of analyzed.fields) {
      input.bindingSourceFiles.set(field.declaration, draft.sourceFile);
      input.fieldByDeclaration.set(field.declaration, field);
    }
    for (const callable of analyzed.callables) {
      input.bindingSourceFiles.set(callable.declaration, draft.sourceFile);
      for (const parameter of callable.parameters) {
        input.bindingSourceFiles.set(parameter.declaration, draft.sourceFile);
      }
      functions.push(callable);
      functionByDeclaration.set(callable.declaration, callable);
    }
    classes.push(analyzed.class_);
    classByDeclaration.set(draft.declaration, analyzed.class_);
    if (analyzed.class_.targetType.kind === "target-named") {
      classByTypeId.set(analyzed.class_.targetType.id, analyzed.class_);
    }
  }

  for (const draft of input.drafts.enums) {
    const analyzed = analyzeMojoEnum({
      source: input.source,
      projectTypes: input.projectTypes,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      allocateMemberName: input.createNameAllocator(),
      bindName(declaration, name) {
        input.bindingNames.set(declaration, name);
        input.bindingSourceFiles.set(declaration, draft.sourceFile);
      },
      diagnostics: input.diagnostics,
    });
    if (analyzed === undefined) continue;
    enums.push(analyzed);
    input.bindingTypes.set(draft.declaration, analyzed.targetType);
    for (const member of analyzed.members) {
      input.fieldByDeclaration.set(member.declaration, member);
      input.bindingTypes.set(member.declaration, analyzed.targetType);
    }
  }

  const closed = closeMojoProjectStateStorage(classes, interfaces);
  const closedClassByDeclaration = new WeakMap<Node, MojoAnalyzedClass>();
  const closedClassByTypeId = new Map<string, MojoAnalyzedClass>();
  for (const class_ of closed.classes) {
    closedClassByDeclaration.set(class_.declaration, class_);
    if (class_.targetType.kind === "target-named") {
      closedClassByTypeId.set(class_.targetType.id, class_);
    }
  }
  const closedInterfaceByTypeId = new Map<string, MojoAnalyzedInterface>();
  for (const interface_ of closed.interfaces) {
    if (interface_.targetType.kind === "target-named") {
      closedInterfaceByTypeId.set(interface_.targetType.id, interface_);
    }
  }
  return {
    functions,
    classes: [...closed.classes],
    interfaces: [...closed.interfaces],
    enums,
    functionByDeclaration,
    classByDeclaration: closedClassByDeclaration,
    classByTypeId: closedClassByTypeId,
    interfaceByTypeId: closedInterfaceByTypeId,
  };
}
