import type { MojoTargetTypeRef } from "./model.js";
import {
  fixedMojoLifecycleContract,
  mojoExplicitLifecycleCapabilities,
  mojoImplicitHeapLifecycleCapabilities,
} from "../lifecycle/contracts.js";

const nativeErrorType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "mojo.builtin.Error",
  modulePath: Object.freeze([]),
  name: "Error",
  lifecycle: fixedMojoLifecycleContract(mojoImplicitHeapLifecycleCapabilities),
});

const sourceErrorType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "tsonic.mojo.runtime.TsError",
  modulePath: Object.freeze(["tsonic_runtime"]),
  name: "TsError",
  lifecycle: fixedMojoLifecycleContract(mojoExplicitLifecycleCapabilities),
});

export function mojoNativeErrorType(): MojoTargetTypeRef {
  return nativeErrorType;
}

export function mojoSourceErrorType(): MojoTargetTypeRef {
  return sourceErrorType;
}
