import type { ProviderMemberDeclaration, ProviderSignatureDeclaration } from "@tsonic/tsts";
import type { MojoCompilerTrait } from "../model/model.js";
import type { MojoProviderOperationDefinition } from "../../packages/model.js";
import { projectMojoCompilerType, projectMojoTargetGenericParameters } from "./types.js";
import type { MojoCompilerTypeProjectionContext } from "./types.js";
import { isDirectMojoSelfReceiver } from "./call-conventions.js";
import { documentation, firstDocumentation, groupByName, projectFunctionSignature } from "./declaration-support.js";

export function projectTraitMembers(
  declaration: MojoCompilerTrait,
  exportId: string,
  context: MojoCompilerTypeProjectionContext,
  operations: MojoProviderOperationDefinition[],
): ProviderMemberDeclaration[] {
  const ownerTarget = projectMojoCompilerType({
    kind: "self",
    memberPath: Object.freeze([]),
    arguments: Object.freeze([]),
  }, context).target;
  const members: ProviderMemberDeclaration[] = declaration.fields.map((field) => {
    const memberId = `${exportId}::field:${field.name}`;
    const projected = projectMojoCompilerType(field.type, context);
    operations.push(Object.freeze({
      exportId,
      memberId,
      operationKind: "property",
      target: Object.freeze({
        kind: "property-read",
        access: Object.freeze({ kind: "member", name: field.name }),
        receiver: "ref",
      }),
      receiverType: ownerTarget,
      resultType: projected.target,
    }));
    return Object.freeze({
      id: memberId,
      name: field.name,
      kind: "property" as const,
      type: projected.source,
      readonly: true,
      ...documentation(field.documentation),
    });
  });
  for (const [name, functions] of groupByName(declaration.functions)) {
    const memberId = `${exportId}::method:${name}`;
    const signatures: ProviderSignatureDeclaration[] = [];
    for (const function_ of functions) {
      const receiver = function_.arguments.find(({ name: argumentName }) => argumentName === "self");
      if (!function_.static && receiver === undefined) {
        throw new Error(`Mojo trait method '${declaration.name}.${name}' has no compiler-owned receiver convention.`);
      }
      if (!function_.static && receiver !== undefined && !isDirectMojoSelfReceiver(receiver.type)) {
        throw new Error(
          `Mojo trait method '${declaration.name}.${name}' has a custom receiver that one TypeScript instance value cannot represent exactly.`,
        );
      }
      const projected = projectFunctionSignature(function_, context, memberId);
      signatures.push(projected.signature);
      operations.push(Object.freeze({
        exportId,
        memberId,
        signatureId: projected.signature.id,
        operationKind: "call",
        target: function_.static
          ? Object.freeze({
              kind: "function-call",
              modulePath: Object.freeze([context.package.packageName, ...context.modulePath]),
              ownerPath: Object.freeze([declaration.name]),
              name,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            })
          : Object.freeze({
              kind: "instance-call",
              name,
              receiver: receiver!.convention,
              ...(function_.genericParameters.length === 0
                ? {}
                : { genericParameters: projectMojoTargetGenericParameters(function_.genericParameters, context) }),
              arguments: projected.targetArguments,
            }),
        ...(function_.static ? {} : { receiverType: projectMojoCompilerType(receiver!.type, {
          ...context, genericParameters: function_.genericParameters,
        }).target }),
        parameterTypes: projected.parameterTargets,
        resultType: projected.resultTarget,
        ...(function_.raises ? { raises: true } : {}),
      }));
    }
    members.push(Object.freeze({
      id: memberId,
      name,
      kind: "method",
      ...(functions.every(({ static: static_ }) => static_) ? { static: true } : {}),
      signatures: Object.freeze(signatures),
      ...firstDocumentation(functions),
    }));
  }
  return members;
}
