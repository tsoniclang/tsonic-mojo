import type { ArgumentPassingMode } from "@tsonic/tsts";
import type { MojoParameterDisposition } from "../../target-model/operations/parameters.js";

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
