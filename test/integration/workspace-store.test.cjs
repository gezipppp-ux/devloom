const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { WorkspaceStore } = require("../../src/storage/workspace-store.cjs");
const { temporary } = require("../support/helpers.cjs");

test("concurrent workspace creation keeps names unique across store instances", async (t) => {
  const directory = temporary(t);
  const barrier = new SharedArrayBuffer(4);
  const workers = Array.from({ length: 4 }, () => new Worker(`
    const { workerData, parentPort } = require("node:worker_threads");
    const { WorkspaceStore } = require(workerData.storeModule);
    const barrier = new Int32Array(workerData.barrier);
    Atomics.add(barrier, 0, 1);
    while (Atomics.load(barrier, 0) < 4)
      Atomics.wait(barrier, 0, Atomics.load(barrier, 0), 10);
    try {
      const config = new WorkspaceStore(workerData.directory).save(
        { name: "同名项目" }, undefined, () => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
          return { version: 3 };
        },
      );
      parentPort.postMessage({ id: config.workspace.id });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    }
  `, {
    eval: true,
    workerData: {
      directory, barrier,
      storeModule: require.resolve("../../src/storage/workspace-store.cjs"),
    },
  }));
  t.after(() => Promise.all(workers.map((worker) => worker.terminate())));
  const results = await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    let result;
    worker.once("message", (message) => { result = message; });
    worker.once("error", reject);
    worker.once("exit", (code) => code === 0 ? resolve(result) : reject(new Error(`Worker exited: ${code}`)));
  })));
  assert.equal(results.filter((result) => result.id).length, 1);
  assert.deepEqual(results.filter((result) => result.error).map((result) => result.error),
    Array(3).fill("工作区名称已存在。"));
  const saved = new WorkspaceStore(directory).list();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].workspace.name, "同名项目");
  assert.deepEqual(fs.readdirSync(directory), [saved[0].workspace.id]);
});

test("workspace updates preserve configuration and omitted icons, and invalid identities cannot create entries", (t) => {
  const directory = temporary(t);
  const store = new WorkspaceStore(directory);
  const initial = store.save({ name: "原始项目" }, undefined, () => ({
    version: 3,
    tapd: { session: { cookie_header: "private-cookie" } },
    codex: { repository: "recorded-repository" },
  }));
  const updated = store.save({ name: "项目新名称" }, initial.workspace.id);
  assert.deepEqual(updated, { ...initial, workspace: { ...initial.workspace, name: "项目新名称" } });
  assert.throws(() => store.save({ name: "新项目" }, ""), /标识/);
  assert.throws(() => store.paths("../outside"), /标识/);
  fs.writeFileSync(path.join(directory, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "unrelated");
  assert.equal(store.list().length, 1);
});
