import { createMojoTargetPack } from "../descriptor/mojo-target-pack.js";

export { createMojoTargetPack } from "../descriptor/mojo-target-pack.js";
export { mojoTargetId } from "../target-model/identities/target.js";
export type { MojoOutputType } from "../target-model/project/model.js";

export function createTsonicPlugin(): import("@tsonic/target-api").TsonicTargetPlugin {
  return Object.freeze({
    kind: "target",
    id: "@tsonic/target-mojo",
    targetId: "mojo",
    createTargetPack: createMojoTargetPack,
  });
}
