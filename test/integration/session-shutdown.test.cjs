const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary } = require("../support/helpers.cjs");

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
    assert.throws(
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
  assert.deepEqual(store.readExecutionSettings(key), {});
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
  await manager.close();
  release.resolve();
  await rejected;
  assert.equal(manager.sessions.size, 0);
  assert.equal(client.calls.length, 0);
});
