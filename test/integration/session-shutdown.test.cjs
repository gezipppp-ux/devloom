const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { setImmediate } = require("node:timers/promises");
const { SessionManager } = require("../support/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary } = require("../support/helpers.cjs");
const { runKey, sourceFor } = require("../../src/domain/run-identity.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(t) {
  const directory = temporary(t);
  const store = new RunStore(directory);
  const key = "1-2";
  fs.mkdirSync(store.dir(key));
  fs.writeFileSync(
    path.join(store.dir(key), "run.json"),
    JSON.stringify({
      source: { channel: "manual", scope: "1", id: "2" },
      agent: { provider: "codex" },
      workitem: { id: "2", workspace_id: "1", title: "shutdown fixture" },
      session_id: "original",
      worktree: { path: directory },
      execution: { status: "completed" },
    }),
  );
  const client = new FakeClient();
  const manager = new SessionManager({
    store,
    client,
    configFile: path.join(directory, "config.json"),
    worktreeReason: () => null,
  });
  t.after(() => manager.close());
  return { store, key, manager, client };
}

for (const blockedMethod of ["thread/read", "thread/resume", "config/read"]) {
  test(`shutdown fences an in-flight ${blockedMethod} before another turn can start`, async (t) => {
    const { manager, client, key, store } = setup(t);
    const entered = deferred(),
      release = deferred();
    const request = client.request.bind(client);
    client.request = async (method, params) => {
      if (method === blockedMethod) {
        entered.resolve();
        await release.promise;
      }
      return request(method, params);
    };
    const sending = manager.send(key, "must not execute after shutdown");
    const rejected = assert.rejects(sending, /关闭/);
    await entered.promise;
    const closing = manager.close();
    assert.equal(manager.close(), closing, "shutdown is idempotent");
    release.resolve();
    await Promise.all([closing, rejected]);
    assert.equal(
      client.calls.some(({ method }) => method === "turn/start"),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(store.dir(key), "web-owner.json")),
      false,
    );
    await assert.rejects(manager.send(key, "after close"), /关闭/);
    await assert.rejects(
      () => manager.updateExecutionSettings(key, { permissionMode: "full" }),
      /关闭/,
    );
  });
}

test("shutdown prevents an in-flight settings validation from persisting after ownership release", async (t) => {
  const { manager, client, key, store } = setup(t);
  const entered = deferred(),
    release = deferred();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === "model/list") {
      entered.resolve();
      await release.promise;
    }
    return request(method, params);
  };
  const updating = manager.updateExecutionSettings(key, {
    model: "fixture-model-a",
    permissionMode: "full",
  });
  const rejected = assert.rejects(updating, /关闭/);
  await entered.promise;
  const closing = manager.close();
  release.resolve();
  await Promise.all([closing, rejected]);
  assert.deepEqual((await store.readExecutionSettings(key)), {});
  assert.equal(
    fs.existsSync(path.join(store.dir(key), "web-owner.json")),
    false,
  );
});

test("shutdown rejects a requirement that finishes resolving after the service closes", async (t) => {
  const { manager, client } = setup(t);
  const entered = deferred(),
    release = deferred();
  manager.channels = {
    get: () => ({
      id: "manual",
      async resolve() {
        entered.resolve();
        await release.promise;
        return { item: {}, config: {} };
      },
    }),
  };
  const starting = manager.start({ channel: "manual" });
  const rejected = assert.rejects(starting, /关闭/);
  await entered.promise;
  const closing = manager.close();
  release.resolve();
  await Promise.all([closing, rejected]);
  assert.equal(manager.sessions.size, 0);
  assert.equal(client.calls.length, 0);
});

for (const entry of ["start", "launch"]) for (const stage of ["claim", "settings", "web", "publish"]) {
  test(`shutdown waits for ${stage} during ${entry} and releases only the unstarted reservation`, async t => {
    const { manager, store, key: existingKey } = setup(t);
    const previous = await store.read(existingKey);
    const item = { id: "shutdown-new", workspace_id: "local", title: "new fake task" };
    const key = runKey(sourceFor("manual", item));
    const channel = { id: "manual", resolve: async () => ({ item, config: { agent: { provider: "codex" } }, session: {} }) };
    manager.channels = { get: () => channel };
    let runs = 0;
    manager.run = async () => { runs++; return { execution: { status: "completed" } }; };
    const [target, method] = {
      claim: [store.requirements, "claim"],
      settings: [manager.settings, "initialize"], web: [store, "writeWeb"], publish: [manager, "publish"],
    }[stage];
    const original = target[method].bind(target);
    const entered = deferred(), release = deferred();
    target[method] = async (...args) => {
      entered.resolve();
      await release.promise;
      return original(...args);
    };
    const starting = entry === "start" ? manager.start({ channel: "manual" })
      : manager.launch(key, item, { agent: { provider: "codex" } }, {}, {}, channel);
    const rejected = assert.rejects(starting, /关闭/);
    await entered.promise;
    let closed = false;
    const closing = manager.close().then(() => { closed = true; });
    await setImmediate();
    assert.equal(closed, false, "close must wait for storage and reservation cleanup");
    release.resolve();
    await Promise.all([closing, rejected]);
    assert.equal(runs, 0);
    assert.equal(manager.sessions.has(key), false);
    assert.equal(store.owned.size, 0);
    assert.deepEqual(await store.requirements.read(key), {});
    assert.deepEqual(await store.read(existingKey), previous, "existing identity and execution remain intact");
    assert.equal(manager.starts.size, 0);
  });
}

test("failed launch setup releases its reservation and permits an explicit retry", async t => {
  const { manager, store } = setup(t);
  const item = { id: "failed-setup", workspace_id: "local", title: "fake task" };
  const key = runKey(sourceFor("manual", item));
  const channel = { id: "manual" };
  const initialize = manager.settings.initialize.bind(manager.settings);
  manager.settings.initialize = async () => { throw new Error("fixture settings failure"); };
  await assert.rejects(manager.launch(key, item, { agent: { provider: "codex" } }, {}, {}, channel), /fixture settings failure/);
  assert.equal(store.owned.size, 0);
  assert.deepEqual(await store.requirements.read(key), {});
  assert.equal(manager.sessions.has(key), false);
  manager.settings.initialize = initialize;
  let runs = 0;
  manager.run = async () => { runs++; return { execution: { status: "completed" } }; };
  assert.equal((await manager.launch(key, item, { agent: { provider: "codex" } }, {}, {}, channel)).accepted, true);
  await manager.sessions.get(key).operation;
  assert.equal(runs, 1);
});
