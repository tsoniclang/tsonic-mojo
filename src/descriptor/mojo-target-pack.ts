import type { TargetPack, TargetToolchain, TargetToolchainContext } from "@tsonic/target-api";
import {
  createMojoCompilationSession,
  mojoTargetProvider,
  mojoTargetSurfaces,
} from "../compilation/index.js";
import { mojoTargetId } from "../target-model/identities/target.js";
import { createMojoToolchain } from "../toolchain/mojo-toolchain.js";

export function createMojoTargetPack(): TargetPack {
  return Object.freeze({
    id: mojoTargetId,
    displayName: "Mojo",
    provider: mojoTargetProvider,
    surfaces: mojoTargetSurfaces,
    createCompilationSession: createMojoCompilationSession,
    createToolchain(context: TargetToolchainContext): TargetToolchain {
      return createMojoToolchain(context);
    },
  });
}
