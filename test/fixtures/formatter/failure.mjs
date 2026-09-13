import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const [mode, ...arguments_] = process.argv.slice(2);
if (arguments_.includes("--version")) {
  process.stdout.write("Mojo 1.0.0 (formatter-failure-fixture)\n");
} else {
  const files = arguments_.filter((argument) => argument.endsWith(".mojo"));
  if (mode === "late") {
    const record = arguments_[0];
    const previous = existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").length : 0;
    appendFileSync(record, JSON.stringify({ files: files.length }) + "\n");
    if (previous > 0) process.exit(42);
    for (const file of files) writeFileSync(file, "staged change that must not escape\n");
  } else if (mode === "signal") {
    process.kill(process.pid, "SIGTERM");
  } else if (mode === "overflow") {
    process.stdout.write("x".repeat(2 * 1024 * 1024));
  } else if (mode === "missing") {
    unlinkSync(files[0]);
  } else {
    process.exit(43);
  }
}
