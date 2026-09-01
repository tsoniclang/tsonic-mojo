import type { ArgumentPassingMode } from "@tsonic/tsts";
import type { MojoAnalyzedParameter } from "../program/model.js";

export function mojoParameterAbi(
  mode: ArgumentPassingMode | undefined,
): {
  readonly convention: MojoAnalyzedParameter["convention"];
  readonly passing: MojoAnalyzedParameter["passing"];
} {
  switch (mode) {
    case "byref-readonly": return { convention: "imm", passing: "plain" };
    case "byref-readwrite":
    case "borrow-mut": return { convention: "mut", passing: "plain" };
    case "byref-writeonly-must-init": return { convention: "out", passing: "plain" };
    case "borrow-shared": return { convention: "ref", passing: "plain" };
    case "move": return { convention: "var", passing: "consume" };
    case "by-value":
    case undefined: return { convention: "var", passing: "plain" };
  }
}
