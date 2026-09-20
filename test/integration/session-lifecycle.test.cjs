const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { setImmediate } = require("node:timers");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary } = require("../support/helpers.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(t, { onStarted, onFinishing } = {}) {
  const directory = temporary(t);
  const store = new RunStore(directory);
  const key = "1-2";
  const client = new FakeClient();
  const started = deferred();
  const state = {
    workitem: { id: "2", workspace_id: "1", title: "lifecycle fixture" },
    worktree: { path: directory },
    execution: { status: "starting" },
  };
  const manager = new SessionManager({
    store,
    client,
    configFile: path.join(directory, "config.json"),
    worktreeReason: () => null,
    async run(_input, { startSession }) {
      const lock = path.join(store.dir(key), ".lock");
      fs.mkdirSync(lock);
      const save = () =>
        fs.writeFileSync(
          path.join(store.dir(key), "run.json"),
          JSON.stringify(state),
        );
      save();
      try {
        const result = await startSession({
          repository: directory,
          task: { codex_prompt: "fixture", images: [] },
          onSession(id) {
            state.session_id = id;
            save();
          },
          async onStarted() {
            started.resolve();
            await onStarted?.();
          },
        });
        await onFinishing?.();
        state.execution = {
          ...result,
          status: result.completed ? "completed" : "failed",
        };
        save();
        return state;
      } finally {
        fs.rmdirSync(lock);
      }
    },
  });
  t.after(() => manager.close());
  manager.launch(key, state.workitem, {}, {});
  return { manager, client, store, key, started: started.promise };
}

test("first-run finalization prevents a new turn from being overwritten while allowing active steering", async (t) => {
  const finishing = deferred(),
    release = deferred();
  const { manager, client, store, key, started } = setup(t, {
    async onFinishing() {
      finishing.resolve();
      await release.promise;
    },
  });
  try {
    await started;
    await manager.send(key, "supplement first turn");
    assert.equal(client.calls.at(-1).method, "turn/steer");
    client.notify("turn/completed", {
      turn: { id: "turn-1", status: "completed" },
    });
    await finishing.promise;
    await assert.rejects(manager.send(key, "too early"), /完成首轮记录/);
    assert.equal(
      client.calls.filter(({ method }) => method === "turn/start").length,
      1,
    );
    release.resolve();
    await manager.sessions.get(key).operation;
    const next = await manager.send(key, "next turn");
    assert.equal(next.sessionId, "original");
    assert.equal(next.turnId, "turn-2");
    assert.equal(store.read(key).execution.status, "running");
  } finally {
    release.resolve();
  }
});

test("shutdown retains ownership until an already-started channel callback finishes", async (t) => {
  const release = deferred();
  const { manager, store, key, started } = setup(t, {
    async onStarted() {
      await release.promise;
    },
  });
  try {
    await started;
    let closed = false;
    const closing = manager.close().then(() => {
      closed = true;
    });
    await manager.sessions.get(key).operation;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    assert.equal(
      fs.existsSync(path.join(store.dir(key), "web-owner.json")),
      true,
    );
    release.resolve();
    await closing;
    assert.equal(
      fs.existsSync(path.join(store.dir(key), "web-owner.json")),
      false,
    );
  } finally {
    release.resolve();
  }
});

test("late first-turn response cannot restore a completed turn while database history is synchronizing", { timeout: 10000 }, async (t) => {
  const startResponse = deferred(), historyReached = deferred(), history = deferred();
  let database, manager;
  t.after(async () => {
    startResponse.resolve();
    history.resolve();
    await manager?.close();
    database?.close();
  });
  const directory = temporary(t);
  database = await initializeDatabase(directory);
  const store = new RunStore(path.join(directory, "runs"));
  const key = "1-2", client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await request(method, params);
    if (method === "turn/start" && result.turn.id === "turn-1") {
      client.notify("turn/completed", { turn: { id: "turn-1", status: "completed" } });
      await startResponse.promise;
    }
    return result;
  };
  const state = {
    workitem: { id: "2", workspace_id: "1", title: "late response fixture" },
    worktree: { path: directory },
    execution: { status: "starting" },
  };
  manager = new SessionManager({
    store, client, configFile: path.join(directory, "config.json"),
    worktreeReason: () => null,
    async run(_input, { startSession }) {
      const save = () => writeConfig(path.join(store.dir(key), "run.json"), state);
      save();
      state.execution = await startSession({
        repository: directory,
        task: { codex_prompt: "fixture", images: [] },
        onSession(id) { state.session_id = id; save(); },
        async onStarted() {},
      });
      save();
      return state;
    },
  });
  manager.views.synchronizeHistory = async () => {
    historyReached.resolve();
    await history.promise;
  };
  manager.launch(key, state.workitem, {}, {});
  await historyReached.promise;
  const runtime = manager.sessions.get(key);
  assert.equal(runtime.status, "completed");
  assert.equal(runtime.turnId, null);
  startResponse.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  history.resolve();
  await runtime.operation;
  assert.equal(runtime.turnId, null);
  assert.equal(runtime.status, "completed");
  const next = await manager.send(key, "start another turn");
  assert.equal(next.sessionId, "original");
  assert.equal(next.turnId, "turn-2");
  assert.equal(client.calls.filter(({ method }) => method === "turn/start").length, 2);
  assert.equal(client.calls.some(({ method }) => method === "turn/steer"), false);
});
