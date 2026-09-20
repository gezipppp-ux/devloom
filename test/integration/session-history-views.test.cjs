const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { SessionViews } = require("../../src/application/session-views.cjs");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { initializationItem } = require("../../src/domain/session-item.cjs");
const { temporary } = require("../support/helpers.cjs");

async function fixture(t, { persisted = true, sessionId = "saved-thread" } = {}) {
  let database;
  t.after(() => database?.close());
  const root = temporary(t);
  if (persisted) database = await initializeDatabase(root);
  const store = new RunStore(path.join(root, "runs"));
  const key = "1-2";
  const initialization = { command: "fixture setup", status: "completed", output: "saved setup" };
  const state = {
    workitem: { id: "2", workspace_id: "1", title: "history fixture" },
    session_id: sessionId,
    execution: { status: "completed" },
    initialization: { commands: [initialization] },
  };
  writeConfig(path.join(store.dir(key), "run.json"), state);
  const runtime = { key, status: "running", items: new Map(), requests: new Map() };
  const client = {
    async connect() { throw new Error("History views must remain readable offline"); },
    async request() { throw new Error("Unexpected Codex request"); },
  };
  const views = new SessionViews({
    store, client, sessions: new Map([[key, runtime]]),
    worktreeReason: () => null, assertOpen() {},
  });
  return { store, key, runtime, views, client, initialization };
}

function messages(count, prefix = "message") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${count - index}`, type: "agentMessage", text: `message ${index}`,
    turnId: "turn-1", status: "completed",
  }));
}

function ids(items) {
  return items.map((item) => item.id);
}

test("SQLite views retain page order, live replacements, unsaved tails and initialization without leaking earlier runtime items", async (t) => {
  const { store, key, runtime, views, initialization } = await fixture(t);
  const saved = messages(80);
  const init = initializationItem(initialization, 0);
  store.saveHistoryItem(key, init);
  for (const item of saved) store.saveHistoryItem(key, item);
  runtime.items = new Map([init, ...saved].map((item) => [item.id, item]));
  runtime.items.set(init.id, { ...init, output: "latest setup output" });
  const replacement = { ...saved.at(-1), text: "latest live delta", status: "inProgress" };
  runtime.items.set(replacement.id, replacement);
  const pending = { id: "pending-delta", type: "agentMessage", text: "not flushed", status: "inProgress" };
  runtime.items.set(pending.id, pending);
  // A matching ID in another task must not classify this unsaved item as old.
  store.saveHistoryItem("1-3", pending);
  store.saveHistoryItem("1-3", saved[30]);
  const page = store.savedHistory(key);
  const view = await views.view(key);
  assert.deepEqual(ids(view.items), [init.id, ...ids(saved.slice(-50)), pending.id]);
  assert.equal(view.items[0].output, "latest setup output");
  assert.equal(view.items.at(-2).text, "latest live delta");
  assert.equal(view.items.at(-2).status, "inProgress");
  assert.equal(view.nextCursor, page.nextCursor);
  const older = await views.history(key, view.nextCursor);
  assert.deepEqual(ids(older.items), [init.id, ...ids(saved.slice(0, -50))]);
  assert.equal(older.nextCursor, null);
  assert.equal(store.savedHistory(key).items.at(-1).text, saved.at(-1).text);
});

test("canonical backfill excludes retained runtime items even when none overlap the latest page", async (t) => {
  const { store, key, runtime, views } = await fixture(t);
  const retained = messages(12, "retained");
  for (const item of retained) {
    store.saveHistoryItem(key, item);
    runtime.items.set(item.id, item);
  }
  const recovered = messages(120, "recovered");
  const canonical = [...retained.slice(0, 6), ...recovered.slice(0, 60),
    ...retained.slice(6), ...recovered.slice(60)];
  store.reconcileHistory(key, canonical, new Date().toISOString());
  const view = await views.view(key);
  assert.deepEqual(ids(view.items).slice(1), ids(canonical.slice(-50)));
  assert.ok(view.nextCursor);
  const previous = await views.history(key, view.nextCursor);
  assert.deepEqual(ids(previous.items), ids(canonical.slice(-100, -50)));
  assert.ok(previous.nextCursor);
});

test("items saved after the first-page snapshot stay visible alongside a buffered delta", async (t) => {
  const { store, key, runtime, views } = await fixture(t);
  const saved = messages(60);
  for (const item of saved) {
    store.saveHistoryItem(key, item);
    runtime.items.set(item.id, item);
  }
  const latest = { id: "just-saved", type: "agentMessage", text: "arrived during view" };
  const buffered = { id: "just-buffered", type: "agentMessage", text: "pending write" };
  const history = views.history.bind(views);
  views.history = async (...args) => {
    const snapshot = await history(...args);
    store.saveHistoryItem(key, latest);
    runtime.items.set(latest.id, latest);
    runtime.items.set(buffered.id, buffered);
    return snapshot;
  };
  const view = await views.view(key);
  assert.deepEqual(ids(view.items).slice(1), [...ids(saved.slice(-50)), latest.id, buffered.id]);
  assert.ok(view.nextCursor);
});

test("empty SQLite pages preserve buffered items and runtime initialization", async (t) => {
  const { store, runtime, views, key, initialization } = await fixture(t);
  const init = { ...initializationItem(initialization, 0), output: "live initialization" };
  const pending = { id: "first-delta", type: "agentMessage", text: "pending write" };
  runtime.items.set(init.id, init);
  runtime.items.set(pending.id, pending);
  const view = await views.view(key);
  assert.deepEqual(ids(view.items), [init.id, pending.id]);
  assert.equal(view.items[0].output, init.output);
  assert.equal(view.nextCursor, null);
  store.saveHistoryItem(key, initializationItem(initialization, 0));
  const savedInitialization = await views.view(key);
  assert.deepEqual(savedInitialization.items, [init, pending]);
});

test("initialization remains visible before a Codex session exists", async (t) => {
  const { runtime, views, key, initialization } = await fixture(t, { sessionId: null });
  const init = { ...initializationItem(initialization, 0), status: "inProgress", output: "still preparing" };
  runtime.items.set(init.id, init);
  const view = await views.view(key);
  assert.deepEqual(view.items, [init]);
  assert.equal(view.nextCursor, null);
  assert.match(view.readOnlyReason, /尚未创建 Codex session/);
});

test("file-adapter pages use live overlap order while preserving unanchored live items", async (t) => {
  const { runtime, views, key, client } = await fixture(t, { persisted: false });
  const saved = messages(60);
  runtime.items = new Map(saved.map((item) => [item.id, item]));
  client.connect = async () => {};
  client.request = async (_method, { cursor }) => ({
    data: (cursor ? saved.slice(0, 10) : saved.slice(-50)).toReversed()
      .map((item) => ({ item, turnId: item.turnId })),
    nextCursor: cursor ? null : "older-page",
  });
  let view = await views.view(key);
  assert.deepEqual(ids(view.items).slice(1), ids(saved.slice(-50)));
  assert.equal(view.nextCursor, "older-page");
  const older = await views.history(key, view.nextCursor);
  assert.deepEqual(ids(older.items), ids(saved.slice(0, 10)));
  assert.equal(older.nextCursor, null);
  runtime.items = new Map([["new-live", { id: "new-live", type: "agentMessage", text: "new delta" }]]);
  view = await views.view(key);
  assert.deepEqual(ids(view.items).slice(1), [...ids(saved.slice(-50)), "new-live"]);
});
