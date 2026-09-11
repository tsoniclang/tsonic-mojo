import type { MojoTargetTypeRef } from "./model.js";
import { fixedMojoLifecycleContract, mojoImplicitHeapLifecycleCapabilities } from "../lifecycle/index.js";

export function mojoNativeArrayType(element: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "target-named", id: "tsonic.mojo.runtime.NativeArray",
    modulePath: Object.freeze(["tsonic_runtime"]), name: "NativeArray",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: element })]),
    lifecycle: fixedMojoLifecycleContract(mojoImplicitHeapLifecycleCapabilities) });
}

export function mojoNativeArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (type.kind !== "target-named" || type.id !== "tsonic.mojo.runtime.NativeArray") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}
