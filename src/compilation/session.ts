import type {
  TargetCompilationSession,
  TargetCompilationSessionContext,
  TargetCompileInput,
} from "@tsonic/target-api";
import type {
  TargetSourceCompilerContributions,
} from "@tsonic/target-api/provider";
import type {
  TargetRuntimeContributions,
  TargetCompileResult,
} from "@tsonic/target-api/artifacts";
import type { TargetSourceProfileContributions } from "@tsonic/target-api/provider";
import { compileMojoTarget } from "../backend/compile.js";
import { createMojoTargetConfiguration } from "../options/mojo-target-options.js";
import { collectMojoProviderSemantics } from "../providers/packages/semantics.js";
import { createMojoSourceSemanticsExtension } from "../source/extension/source-extension.js";
import { mojoSourceSemanticsModules } from "../source/profiles/source-modules.js";
import {
  mojoJsSourceProfileOwnerId,
  mojoNativeSourceProfileContributions,
} from "../source/profiles/declarations.js";
import { mojoRuntimePackageReference } from "./runtime-references.js";

type SessionState =
  | "created"
  | "profile-contributed"
  | "compiler-contributed"
  | "runtime-contributed"
  | "compiled"
  | "closed";

export function createMojoCompilationSession(
  context: TargetCompilationSessionContext,
): TargetCompilationSession {
  const configuration = createMojoTargetConfiguration(
    context.target,
    context.projectDirectory,
    context.paths.targetOutputRoot,
  );
  const providerSemantics = collectMojoProviderSemantics(context.capabilities);
  const jsEnabled = context.selectedSurfaceIds.includes(mojoJsSourceProfileOwnerId);
  let state: SessionState = "created";
  return Object.freeze({
    sourceProfileContributions(): TargetSourceProfileContributions {
      requireState(state, "created", "sourceProfileContributions");
      state = "profile-contributed";
      return jsEnabled
        ? Object.freeze({ declarations: Object.freeze([]) })
        : mojoNativeSourceProfileContributions();
    },
    sourceCompilerContributions(): TargetSourceCompilerContributions {
      requireState(state, "profile-contributed", "sourceCompilerContributions");
      state = "compiler-contributed";
      return Object.freeze({
        semanticsModules: mojoSourceSemanticsModules(),
        extensions: Object.freeze([createMojoSourceSemanticsExtension()]),
      });
    },
    runtimeContributions(): TargetRuntimeContributions {
      requireState(state, "compiler-contributed", "runtimeContributions");
      state = "runtime-contributed";
      return Object.freeze({
        references: Object.freeze([
          mojoRuntimePackageReference(context, "@tsonic/mojo-runtime", "tsonic_runtime"),
        ]),
      });
    },
    compile(input: TargetCompileInput): TargetCompileResult {
      requireState(state, "runtime-contributed", "compile");
      state = "compiled";
      return compileMojoTarget(Object.freeze({
        input,
        configuration,
        providerSemantics,
        jsEnabled,
      }));
    },
    close(): void {
      state = "closed";
    },
  });
}

function requireState(actual: SessionState, expected: SessionState, operation: string): void {
  if (actual !== expected) {
    throw new Error(
      `Mojo compilation session cannot call '${operation}' while in '${actual}'; expected '${expected}'.`,
    );
  }
}
