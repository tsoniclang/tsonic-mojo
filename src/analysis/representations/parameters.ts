import type { ArgumentPassingMode } from "@tsonic/tsts";
import type { MojoCallArgumentConvention } from "../../target-model/types/model.js";
import type {
  MojoArgumentDisposition,
  MojoParameterDisposition,
} from "./model.js";

export function analyzeMojoParameterDisposition(
  mode: ArgumentPassingMode | undefined,
  bindingWritten: boolean,
): MojoParameterDisposition {
  switch (mode) {
    case "byref-readwrite":
    case "borrow-mut":
      return Object.freeze({ kind: "mutable-reference" });
    case "borrow-shared":
      return Object.freeze({ kind: "parametric-reference" });
    case "byref-writeonly-must-init":
      return Object.freeze({ kind: "out" });
    case "move":
      return Object.freeze({ kind: "owned" });
    case "byref-readonly":
    case "by-value":
    case undefined:
      return Object.freeze({ kind: "immutable", localCopy: bindingWritten });
  }
}

export function mojoParameterConvention(
  disposition: MojoParameterDisposition,
): Exclude<MojoCallArgumentConvention, "deinit"> {
  switch (disposition.kind) {
    case "immutable": return "imm";
    case "mutable-reference": return "mut";
    case "parametric-reference": return "ref";
    case "owned": return "var";
    case "out": return "out";
  }
}

export function mojoParameterArgumentDisposition(
  disposition: MojoParameterDisposition,
): MojoArgumentDisposition {
  return disposition.kind === "owned"
    ? Object.freeze({ kind: "transfer" })
    : Object.freeze({ kind: "plain" });
}
