import {
  aggregateMojoLifecycleContract,
  fixedMojoLifecycleContract,
  mojoExplicitLifecycleCapabilities,
  mojoImplicitHeapLifecycleCapabilities,
} from "../../target-model/lifecycle/index.js";

export const implicitHeapLifecycle = fixedMojoLifecycleContract(
  mojoImplicitHeapLifecycleCapabilities,
);

export const explicitLifecycle = fixedMojoLifecycleContract(
  mojoExplicitLifecycleCapabilities,
);

export const nativeSetLifecycle = aggregateMojoLifecycleContract([0], {
  implicitCopyWhenPossible: false,
  explicitDestruction: true,
});
