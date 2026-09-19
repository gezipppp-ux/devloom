const assert = require("node:assert/strict");
const { test } = require("node:test");
const { prepareCliDatabase } = require("../../src/cli/database-context.cjs");
const { temporary } = require("../support/helpers.cjs");

test("explicit CLI config excludes the overridden workspace from authorization and audit", async (t) => {
  let database;
  t.after(() => database?.close());
  const directory = temporary(t);
  const env = { RUNNER_DATA_DIR: directory, RUNNER_WORKSPACE: "missing-environment-workspace" };
  database = await prepareCliDatabase([
    "--config", "explicit.json", "--app-workspace", "missing-argument-workspace",
  ], env);
  const audit = database.handle.prepare("SELECT workspace_id,details_json FROM audit_events WHERE event='local_cli'").get();
  assert.equal(audit.workspace_id, null);
  assert.deepEqual(JSON.parse(audit.details_json), { actorType: "local_operator" });
  database.close();
  await assert.rejects(prepareCliDatabase([], env), /不存在|无效/);
});
