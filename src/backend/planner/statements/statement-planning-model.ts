import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoStatement } from "../../target-ast/index.js";

export interface MojoStatementPlanningScope {
  readonly resultType?: MojoTargetTypeRef;
  readonly returnAllowed: boolean;
  readonly omittedStatements?: ReadonlySet<Node>;
}

export interface MojoFlowPlanningContext {
  readonly continueStatements?: readonly MojoStatement[];
}
