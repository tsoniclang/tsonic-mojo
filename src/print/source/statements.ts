import type { MojoCatchClause, MojoStatement } from "../../backend/target-ast/index.js";
import {
  block,
  concat,
  emptyDocument,
  group,
  hardLine,
  join,
  text,
} from "../document/builders.js";
import type { MojoDocument } from "../document/model.js";
import type { MojoPrintContext } from "./context.js";
import { printMojoExpressionDocument } from "./expressions.js";
import { requiredMojoTypeDocument } from "./types.js";

export function printMojoStatementDocument(
  statement: MojoStatement,
  context: MojoPrintContext,
): MojoDocument {
  switch (statement.kind) {
    case "return": return statement.expression === undefined
      ? text("return")
      : group(concat(text("return "), printMojoExpressionDocument(statement.expression, context)));
    case "variable": return group(concat(
      text(`${statement.compileTime === true ? "comptime" : "var"} ${statement.name}`),
      statement.type === undefined
        ? emptyDocument
        : concat(text(": "), requiredMojoTypeDocument(statement.type, context)),
      statement.initializer === undefined
        ? emptyDocument
        : concat(text(" = "), printMojoExpressionDocument(statement.initializer, context)),
    ));
    case "tuple-variable": {
      const names = statement.names.length === 1
        ? `${statement.names[0]!},`
        : statement.names.join(", ");
      return group(concat(
        text(`var (${names}) = `),
        printMojoExpressionDocument(statement.initializer, context),
      ));
    }
    case "assignment": return group(concat(
      printMojoExpressionDocument(statement.left, context),
      text(` ${statement.operator} `),
      printMojoExpressionDocument(statement.right, context),
    ));
    case "expression": return printMojoExpressionDocument(statement.expression, context);
    case "discard": return group(concat(
      text("_ = "),
      printMojoExpressionDocument(statement.expression, context),
    ));
    case "if": {
      const result: MojoDocument[] = [block(
        group(concat(
          text(statement.compileTime === true ? "comptime if " : "if "),
          printMojoExpressionDocument(statement.condition, context),
        )),
        printMojoBodyDocument(statement.thenStatements, context),
      )];
      if (statement.elseStatements !== undefined) {
        result.push(hardLine, block(text("else"), printMojoBodyDocument(statement.elseStatements, context)));
      }
      return concat(...result);
    }
    case "while": return block(
      group(concat(text("while "), printMojoExpressionDocument(statement.condition, context))),
      printMojoBodyDocument(statement.statements, context),
    );
    case "for": return block(
      group(concat(
        text(statement.compileTime === true ? "comptime for " : "for "),
        text(`${statement.binding} in `),
        printMojoExpressionDocument(statement.iterable, context),
      )),
      printMojoBodyDocument(statement.statements, context),
    );
    case "break": return text("break");
    case "continue": return text("continue");
    case "pass": return text("pass");
    case "raise": return statement.expression === undefined
      ? text("raise")
      : group(concat(text("raise "), printMojoExpressionDocument(statement.expression, context)));
    case "try": {
      const result: MojoDocument[] = [block(text("try"), printMojoBodyDocument(statement.statements, context))];
      for (const catch_ of statement.catches) {
        result.push(hardLine, printCatchDocument(catch_, context));
      }
      if (statement.finallyStatements !== undefined) {
        result.push(
          hardLine,
          block(text("finally"), printMojoBodyDocument(statement.finallyStatements, context)),
        );
      }
      return concat(...result);
    }
    case "with": return block(
      group(concat(
        text("with "),
        printMojoExpressionDocument(statement.expression, context),
        statement.binding === undefined ? emptyDocument : text(` as ${statement.binding}`),
      )),
      printMojoBodyDocument(statement.statements, context),
    );
  }
}

export function printMojoBodyDocument(
  statements: readonly MojoStatement[],
  context: MojoPrintContext,
): MojoDocument {
  return statements.length === 0
    ? text("pass")
    : join(hardLine, statements.map((statement) => printMojoStatementDocument(statement, context)));
}

function printCatchDocument(catch_: MojoCatchClause, context: MojoPrintContext): MojoDocument {
  return block(
    text(`except${catch_.name === undefined ? "" : ` ${catch_.name}`}`),
    printMojoBodyDocument(catch_.statements, context),
  );
}
