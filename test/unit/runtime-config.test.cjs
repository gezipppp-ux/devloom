const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { temporary } = require("../support/helpers.cjs");
const { loadConfig, runsPath } = require("../../src/config/runtime.cjs");

test("configuration reads only the explicitly selected file without inspecting CLI arguments", (t) => {
  const directory = temporary(t);
  const file = path.join(directory, "config.json");
  fs.writeFileSync(file, '\uFEFF{"workspace":{"id":"selected"}}');
  const argv = process.argv;
  process.argv = [process.execPath, "test", "--config", "--app-workspace"];
  t.after(() => {
    process.argv = argv;
  });
  const config = loadConfig(file);
  assert.equal(config.workspace.id, "selected");
  assert.equal(runsPath(config, file), path.join(directory, "runs"));
  assert.throws(() => loadConfig(), /absolute configuration file path/);
  assert.throws(
    () => loadConfig("relative.json"),
    /absolute configuration file path/,
  );
});
