const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { SessionHistoryStore } = require("../../src/storage/session-history-store.cjs");
const { temporary } = require("../support/helpers.cjs");

test("history reconciliation restores older ordering without replacing newer live data or allowing foreign cursors", async (t) => {
  let database;
  t.after(() => database?.close());
  const directory = temporary(t);
  database = await initializeDatabase(directory);
  const history = new SessionHistoryStore(path.join(directory, "runs", "1-2"));
  const foreign = new SessionHistoryStore(path.join(directory, "runs", "1-3"));
  history.save({ id: "live", type: "agentMessage", text: "initial live content" });
  history.save({ id: "previous", type: "commandExecution", output: "partial output" });
  database.handle.prepare("UPDATE session_items SET updated_at=? WHERE run_path=?")
    .run("2000-01-01T00:00:00.000Z", history.key);
  const liveRow = database.handle.prepare("SELECT id FROM session_items WHERE run_path=? AND item_id=?").get(history.key, "live");
  // The snapshot began before these updates; its older copy of the same item
  // must not replace the freshly received response or remove the next item.
  const snapshotStartedAt = "2020-01-01T00:00:00.000Z";
  history.save({ id: "live", type: "agentMessage", text: "new live content" });
  history.save({ id: "tail", type: "agentMessage", text: "arrived after snapshot" });
  const older = Array.from({ length: 60 }, (_, index) => ({
    id: "older-" + index, type: "agentMessage", text: "older content " + index,
  }));
  const canonical = [
    { id: "previous", type: "commandExecution", output: "complete historical output" },
    ...older,
    { id: "live", type: "agentMessage", text: "stale snapshot content" },
  ];
  history.reconcile(canonical, snapshotStartedAt);
  const expectedIds = [...canonical.map(({ id }) => id), "tail"];
  const first = history.list();
  const second = history.list(first.nextCursor);
  assert.deepEqual(first.items.map(({ id }) => id), expectedIds.slice(-50));
  assert.deepEqual(second.items.map(({ id }) => id), expectedIds.slice(0, -50));
  assert.equal(second.nextCursor, null);
  assert.equal(first.items.find(({ id }) => id === "live").text, "new live content");
  assert.equal(first.items.at(-1).text, "arrived after snapshot");
  assert.equal(second.items[0].output, "complete historical output");
  assert.equal(database.handle.prepare("SELECT id FROM session_items WHERE run_path=? AND item_id=?").get(history.key, "live").id, liveRow.id);
  foreign.save({ id: "live", type: "agentMessage", text: "unrelated task" });
  assert.throws(() => foreign.list(first.nextCursor), /不属于当前任务/);
  assert.equal(foreign.list().items[0].text, "unrelated task");
  assert.throws(() => history.list("db:9007199254740992"), /无效/);
});
