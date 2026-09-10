import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSourceProfileParameterContract } from "./source-profile-selection.js";
import { mojoDynamicTargetType, mojoNamedTargetType, mojoPrimitiveTargetType, mojoStringTargetType } from "../../target-model/types/constructors.js";

export function sourceProfileParameterType(
  contract: MojoSourceProfileParameterContract,
  receiver: MojoTargetTypeRef | undefined,
): MojoTargetTypeRef | undefined {
  if (typeof contract !== "string") {
    if (contract.kind === "optional") {
      const value = sourceProfileParameterType(contract.value, receiver);
      return value === undefined ? undefined : Object.freeze({ kind: "optional", value });
    }
    if (contract.kind === "receiver") return receiver;
    const value = receiver?.kind === "optional" ? receiver.value : receiver;
    if (value?.kind !== "target-named") return undefined;
    const argument = value.genericArguments?.[contract.index];
    return argument?.kind === "type" ? argument.type : undefined;
  }
  switch (contract) {
    case "float64":
      return mojoPrimitiveTargetType("float64");
    case "js-string":
      return mojoNamedTargetType(
        "tsonic.mojo.js.JsString",
        ["tsonic_js"],
        "JsString",
      );
    case "js-value":
    case "js-data":
      return mojoDynamicTargetType("js");
    case "native-string":
      return mojoStringTargetType();
    case "selected-argument":
      return undefined;
  }
}
