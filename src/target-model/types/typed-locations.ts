import type { MojoTargetTypeRef } from "./model.js";
import { fixedMojoLifecycleContract, mojoImplicitHeapLifecycleCapabilities } from "../lifecycle/index.js";

export function mojoTypedLocationType(pointee: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named", id: "tsonic.mojo.runtime.TypedLocation",
    modulePath: Object.freeze(["tsonic_runtime"]), name: "TypedLocation",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: pointee })]),
    lifecycle: fixedMojoLifecycleContract(mojoImplicitHeapLifecycleCapabilities),
  });
}

export function mojoTypedLocationPointee(type: MojoTargetTypeRef | undefined): MojoTargetTypeRef | undefined {
  if (type?.kind === "optional") return mojoTypedLocationPointee(type.value);
  if (type?.kind !== "target-named" || type.id !== "tsonic.mojo.runtime.TypedLocation") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}
