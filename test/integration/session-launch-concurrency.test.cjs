const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { temporary } = require("../support/helpers.cjs");
const { runKey } = require("../../src/domain/run-identity.cjs");

async function fixture(t, { fingerprint } = {}) {
  const directory = temporary(t);
  const store = new RunStore(path.join(directory, "runs"));
  const metadataEntered = Promise.withResolvers();
  const metadataRelease = Promise.withResolvers();
  const running = Promise.withResolvers();
  const complete = Promise.withResolvers();
  const calls = [];
  const agent = new EventEmitter();
  Object.assign(agent, {
    id: "fixture", capabilities: { resume: true, steer: true },
    refreshGitCredentials: async () => { calls.push("refresh"); },
    validateCommand: () => {},
    validateSelection: async () => ({ model: "", reasoningEffort: "", permissionMode: "ask" }),
    assertPermissionAvailable: async () => {},
    steerTurn: async () => { calls.push("steer"); },
    interruptTurn: async () => {},
    close: async () => {},
  });
  const key = runKey({ channel: "tapd", scope: "1", id: "2" });
  const item = { id: "2", workspace_id: "1", title: "Concurrent start fixture",
    ...(fingerprint ? { request_fingerprint: fingerprint } : {}) };
  const config = { agent: { provider: "fixture" }, execution: { repository: directory, worktreeRoot: directory } };
  const channel = { id: "tapd", resolve: async () => ({ item, config }) };
  let runs = 0;
  const manager = new SessionManager({
    store, agent, configFile: path.join(directory, "config.json"), worktreeReason: () => null,
    channels: { get: () => channel },
    async run() {
      runs++;
      const state = { agent: config.agent, source: { channel: "tapd", scope: "1", id: "2" },
        workitem: item, session_id: "persistent-session", worktree: { path: directory }, execution: { status: "running" } };
      await writeConfig(path.join(store.dir(key), "run.json"), state);
      running.resolve();
      await complete.promise;
      state.execution.status = "completed";
      await writeConfig(path.join(store.dir(key), "run.json"), state);
      return state;
    },
  });
  const originalMetadata = store.writeTaskMetadata.bind(store);
  store.writeTaskMetadata = async (...args) => {
    metadataEntered.resolve();
    await metadataRelease.promise;
    return originalMetadata(...args);
  };
  t.after(async () => {
    metadataRelease.resolve();
    complete.resolve();
    await manager.close();
  });
  return { manager, agent, store, key, item, config, channel, calls, metadataEntered,
    metadataRelease, running, complete, runs: () => runs,
    launch: () => manager.launch(key, item, config, null, {}, channel) };
}

test("same-key concurrent starts reserve one runtime and release the start lock before active steering", { timeout: 10000 }, async (t) => {
  const context = await fixture(t);
  const { manager, store, key } = context;
  const first = context.launch();
  await context.metadataEntered.promise;
  const second = context.launch().then(value => ({ value }), error => ({ error }));
  context.metadataRelease.resolve();
  const [accepted, duplicate] = await Promise.all([first, second]);
  assert.equal(accepted.accepted, true);
  assert.match(duplicate.error?.message || "", /上一条操作尚未完成|已有运行记录/);
  await context.running.promise;
  assert.equal(context.runs(), 1);
  const runtime = manager.sessions.get(key);
  assert.ok(runtime);
  assert.equal(fs.existsSync(path.join(store.dir(key), "web-owner.json")), true);
  assert.equal(manager.operations.has(key), false, "the pipeline lifetime must not hold the start reservation");
  runtime.connected = true;
  runtime.sessionId = "persistent-session";
  runtime.turnId = "first-turn";
  runtime.status = "running";
  await manager.send(key, "steer the accepted first turn");
  assert.equal(context.calls.at(-1), "steer");
  assert.equal(manager.sessions.get(key), runtime);
  context.complete.resolve();
  await runtime.operation;
});

test("a busy matching-fingerprint retry can be rejected and a later retry reuses the accepted pipeline", { timeout: 10000 }, async (t) => {
  const context = await fixture(t, { fingerprint: "same-fingerprint" });
  const first = context.manager.start({ channel: "tapd" });
  await context.metadataEntered.promise;
  const second = context.manager.start({ channel: "tapd" })
    .then(value => ({ value }), error => ({ error }));
  context.metadataRelease.resolve();
  const [accepted, duplicate] = await Promise.all([first, second]);
  assert.equal(accepted.accepted, true);
  if (duplicate.error) assert.match(duplicate.error.message, /上一条操作尚未完成/);
  else assert.equal(duplicate.value.reused, true);
  await context.running.promise;
  const runtime = context.manager.sessions.get(context.key);
  const operation = runtime.operation;
  const owner = fs.readFileSync(path.join(context.store.dir(context.key), "web-owner.json"), "utf8");
  const retry = await context.launch();
  assert.equal(retry.reused, true);
  assert.equal(context.runs(), 1);
  assert.equal(context.manager.sessions.get(context.key), runtime);
  assert.equal(runtime.operation, operation);
  assert.equal(fs.readFileSync(path.join(context.store.dir(context.key), "web-owner.json"), "utf8"), owner);
  context.complete.resolve();
  await operation;
});

test("direct launch finishes credential refresh before reserving the task key", { timeout: 10000 }, async (t) => {
  const context = await fixture(t);
  const refreshing = Promise.withResolvers();
  const releaseRefresh = Promise.withResolvers();
  context.agent.refreshGitCredentials = async () => {
    assert.equal(context.manager.operations.has(context.key), false);
    refreshing.resolve();
    await releaseRefresh.promise;
  };
  const starting = context.launch();
  try {
    await refreshing.promise;
    assert.equal(context.manager.operations.has(context.key), false);
    assert.equal(context.runs(), 0);
    releaseRefresh.resolve();
    await context.metadataEntered.promise;
    assert.equal(context.manager.operations.has(context.key), true);
    context.metadataRelease.resolve();
    await starting;
    await context.running.promise;
  } finally {
    releaseRefresh.resolve();
    context.metadataRelease.resolve();
    context.complete.resolve();
    await starting;
  }
});
