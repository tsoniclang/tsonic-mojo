import type { ArgumentPassingMode } from "@tsonic/tsts";
import type { MojoCallArgumentConvention } from "../../../target-model/types/model.js";

export function projectMojoPassingMode(
  convention: MojoCallArgumentConvention,
): ArgumentPassingMode {
  switch (convention) {
    case "imm": return "byref-readonly";
    case "mut": return "byref-readwrite";
    case "var": return "move";
    case "ref": return "borrow-shared";
    case "out": return "byref-writeonly-must-init";
    case "deinit": return "move";
  }
}
