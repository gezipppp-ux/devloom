const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { initializeTestDatabase } = require("../support/database.cjs");
const { SessionHistoryStore } = require("../../src/storage/session-history-store.cjs");
const { temporary } = require("../support/helpers.cjs");

test("history reconciliation restores older ordering without replacing newer live data or allowing foreign cursors", async (t) => {
  let database;
  t.after(() => database?.close());
  const directory = temporary(t);
  database = await initializeTestDatabase(t, directory);
  const history = new SessionHistoryStore(path.join(directory, "runs", "1-2"));
  const foreign = new SessionHistoryStore(path.join(directory, "runs", "1-3"));
  (await history.save({ id: "live", type: "agentMessage", text: "initial live content" }));
  (await history.save({ id: "previous", type: "commandExecution", output: "partial output" }));
  await database.client.sessionItem.updateMany({ where: { runPath: history.key }, data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") } });
  const liveRow = (await database.client.sessionItem.findUniqueOrThrow({ where: { runPath_itemId: { runPath: history.key, itemId: "live" } } }));
  // The snapshot began before these updates; its older copy of the same item
  // must not replace the freshly received response or remove the next item.
  const snapshotStartedAt = "2020-01-01T00:00:00.000Z";
  (await history.save({ id: "live", type: "agentMessage", text: "new live content" }));
  (await history.save({ id: "tail", type: "agentMessage", text: "arrived after snapshot" }));
  const older = Array.from({ length: 60 }, (_, index) => ({
    id: "older-" + index, type: "agentMessage", text: "older content " + index,
  }));
  const canonical = [
    { id: "previous", type: "commandExecution", output: "complete historical output" },
    ...older,
    { id: "live", type: "agentMessage", text: "stale snapshot content" },
  ];
  (await history.reconcile(canonical, snapshotStartedAt));
  const expectedIds = [...canonical.map(({ id }) => id), "tail"];
  const first = (await history.list());
  const second = (await history.list(first.nextCursor));
  assert.deepEqual(first.items.map(({ id }) => id), expectedIds.slice(-50));
  assert.deepEqual(second.items.map(({ id }) => id), expectedIds.slice(0, -50));
  assert.equal(second.nextCursor, null);
  assert.equal(first.items.find(({ id }) => id === "live").text, "new live content");
  assert.equal(first.items.at(-1).text, "arrived after snapshot");
  assert.equal(second.items[0].output, "complete historical output");
  assert.equal((await database.client.sessionItem.findUniqueOrThrow({ where: { runPath_itemId: { runPath: history.key, itemId: "live" } } })).id, liveRow.id);
  (await foreign.save({ id: "live", type: "agentMessage", text: "unrelated task" }));
  (await assert.rejects(async () => (await foreign.list(first.nextCursor)), /不属于当前任务/));
  assert.equal((await foreign.list()).items[0].text, "unrelated task");
  (await assert.rejects(async () => (await history.list("db:9007199254740992")), /无效/));
});
