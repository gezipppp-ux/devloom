const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createTapdChannel } = require("../../src/channels/tapd/adapter.cjs");
const { WorkspaceServices } = require("../../src/application/workspace-services.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { saveState } = require("../../src/storage/run-state.cjs");
const { readTapdSettings, saveTapdSettings } = require("../../src/channels/tapd/settings.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { item, session, json, temporary } = require("../support/helpers.cjs");

test("TAPD searches all todo pages, types and statuses and marks only this workspace's local progress", async (t) => {
  const root = temporary(t);
  const configFile = path.join(root, "config.json");
  const config = {
    agent: { provider: "codex" },
    tapd: { session: { ...session, request_body: {
      ...session.request_body,
      tab: "done",
      select_object_types: ["story"],
      search_filter: { common: { data: [{ fieldSystemName: "status", value: ["open"] }] } },
    } } },
    workflow: { allow_write: true, target_status: "custom-developing" },
  };
  fs.writeFileSync(configFile, JSON.stringify(config));
  const first = new SessionManager({ configFile, runsDirectory: path.join(root, "first"), client: new FakeClient() });
  const second = new SessionManager({ configFile, runsDirectory: path.join(root, "second"), client: new FakeClient() });
  t.after(() => first.close());
  t.after(() => second.close());
  for (const id of ["1", "2", "3"]) {
    (await saveState(path.join(first.store.dir(`1-${id}`), "run.json"), {
      agent: { provider: "codex" }, workitem: { ...item, id },
      execution: { status: id === "1" ? "completed" : "running" },
      session_id: `existing-${id}`,
    }));
  }
  (await first.store.writeTaskMetadata("1-2", { progress: "done" }));
  (await first.store.writeTaskMetadata("1-3", { progress: "on_hold" }));
  // An equal item ID in a different TAPD project must not mark this result.
  (await saveState(path.join(first.store.dir("9-4"), "run.json"), { agent: { provider: "codex" }, workitem: { ...item, id: "4", workspace_id: "9" } }));
  const rows = Array.from({ length: 21 }, (_, i) => ({
    ...item,
    id: String(i + 1),
    entity_type: ["Story", "Bug", "board_card"][i % 3],
    status: ["open", "developing", "custom-status"][i % 3],
  }));
  const pages = [];
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(String(url), session.endpoint);
    const body = JSON.parse(options.body);
    assert.equal(body.tab, "todo");
    assert.deepEqual(body.select_object_types, ["story", "board_card", "bug"]);
    assert.equal(body.search_filter.common.data.some((field) => field.fieldSystemName === "status"), false);
    pages.push(body.page);
    return json({ record_total: "0", workitem_list: rows.slice((body.page - 1) * 20, body.page * 20) });
  });
  const services = new WorkspaceServices({ configFile, sessions: first });
  const results = await services.search("tapd", { workspace: "1", query: "" });
  assert.equal(results.length, 21);
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(results.slice(0, 3).map((row) => row.type), ["story", "bug", "board_card"]);
  assert.deepEqual(results.slice(0, 3).map((row) => row.localRun.progress), ["in_progress", "done", "on_hold"]);
  assert.equal(results[3].localRun, null);
  assert.equal(results[20].localRun, null);
  const other = await new WorkspaceServices({ configFile, sessions: second }).search("tapd", { workspace: "1" });
  assert.ok(other.every((row) => row.localRun === null));
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), config);
});

test("TAPD preparation and legacy transition hooks never call workflow or personnel APIs", async (t) => {
  const root = temporary(t);
  const configFile = path.join(root, "config.json");
  t.mock.method(global, "fetch", () => { throw new Error("Unexpected TAPD network request"); });
  for (const workflow of [undefined, { allow_write: false }, { allow_write: true, target_status: "custom" }]) {
    fs.writeFileSync(configFile, JSON.stringify({ tapd: { session }, workflow }));
    const channel = createTapdChannel(configFile, {
      detail: async (_session, selected) => ({ ...item, ...selected }),
      buildTask: async () => ({ execution_ready: true, images: [] }),
      workflowInfo: () => assert.fail("workflow preflight is removed"),
      applyTransition: () => assert.fail("TAPD writes are removed"),
      searchUsers: () => assert.fail("personnel validation is removed"),
    });
    assert.equal(channel.capabilities.assignees, false);
    for (const type of ["story", "bug", "board_card"]) {
      const resolved = await channel.resolve({ id: item.id, workspace: "1", type });
      assert.deepEqual(resolved.config.workflow, workflow);
      const prepared = await channel.prepare({ ...resolved, directory: root });
      assert.equal(prepared.workitem.type, type);
      assert.equal(prepared.target, undefined);
      assert.deepEqual(await channel.transition({ ...resolved, state: { workitem: item, target_status: "custom" } }), { status: "skipped" });
    }
    await assert.rejects(channel.resolve({ id: item.id, workspace: "1", type: "invalid" }), /类型/);
  }
  assert.equal(Object.hasOwn((await readTapdSettings(configFile)), "targetStatus"), false);
  (await assert.rejects(async () => (await saveTapdSettings(configFile, { workspaceId: "1", targetStatus: "developing" })), /无效的 TAPD 配置字段/));
});
