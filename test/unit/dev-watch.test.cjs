const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { main } = require("../../src/cli/dev-watch.cjs");
const { temporary } = require("../support/helpers.cjs");

async function until(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

test("development watcher coalesces a save received while the child is stopping", async (t) => {
  const directory = temporary(t);
  const source = path.join(directory, "src");
  const recordsFile = path.join(directory, "records.jsonl");
  const entry = path.join(directory, "fixture-server.cjs");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(directory, "shared"));
  fs.writeFileSync(
    entry,
    `const fs = require("node:fs");
const recordsFile = ${JSON.stringify(recordsFile)};
const record = (event) => fs.appendFileSync(recordsFile, JSON.stringify({ event, pid: process.pid }) + "\\n");
record("start");
process.send({ type: "dev:ready" });
process.on("message", (message) => {
  if (message?.type !== "dev:shutdown") return;
  record("stopping");
  setTimeout(() => process.exit(0), 100);
});
`,
  );
  const records = () =>
    fs.existsSync(recordsFile)
      ? fs
          .readFileSync(recordsFile, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  const service = await main([], {
    directory,
    entry,
    debounceMs: 10,
    shutdownTimeoutMs: 1000,
  });
  try {
    fs.writeFileSync(path.join(source, "change.cjs"), "// first save\n");
    await until(
      () => records().some(({ event }) => event === "stopping"),
      "The initial development child did not begin stopping.",
    );
    fs.appendFileSync(path.join(source, "change.cjs"), "// second save\n");
    await until(
      () => records().filter(({ event }) => event === "start").length === 2,
      "The replacement development child did not start.",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      records().filter(({ event }) => event === "start").length,
      2,
      "A save during shutdown must not start and immediately close an extra child.",
    );
  } finally {
    await service.close();
  }
});
