const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { setImmediate } = require("node:timers");
const { temporary } = require("../support/helpers.cjs");
const { waitForClone } = require("../support/workspace-clones.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { GitAccountServices } = require("../../src/application/git-account-services.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { WorkspaceCloneManager } = require("../../src/application/workspace-clone-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

async function fixture(t) {
  let database, accounts, clones;
  t.after(async () => { await clones?.close(); await accounts?.close(); await database?.close(); });
  const directory = temporary(t);
  database = await initializeTestDatabase(t, directory);
  accounts = new AccountServices(database);
  const actor = await accounts.create({ username: "admin", password: "clone-fixture" }, null, true);
  const department = await database.client.department.create({ data: { name: "Fixture department", permissions: [] } });
  const other = await accounts.create({ departmentId: department.id, username: "member", password: "clone-fixture" }, actor);
  const git = new GitAccountServices(database, { checkConnection: async () => {} });
  const account = await git.save(actor, { name: "Fixture Git", authType: "http", host: "http://git.example.test", username: "fixture", password: "secret-clone-password" });
  const pending = [];
  const workspaces = new WorkspaceManager({ database, directory: path.join(directory, "workspaces"),
    cloneProject: options => new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(new Error("aborted"));
      pending.push({ ...options, finish: () => { try { resolve(options.publish()); } catch (error) { reject(error); } }, fail: reject });
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  clones = new WorkspaceCloneManager(database, workspaces);
  const input = { requestId: randomUUID(), name: "项目", gitAccountId: account.id, remoteUrl: "http://git.example.test/team/project.git" };
  const tick = async () => {
    const deadline = Date.now() + 10000;
    while (!pending.some(item => !item.signal?.aborted) && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  };
  return { database, accounts, actor, other, workspaces, clones, pending, input, tick };
}

test("clone jobs persist progress, isolate owners, deduplicate requests and publish atomically", async t => {
  const { database, actor, other, clones, workspaces, pending, input, tick } = await fixture(t);
  const job = (await clones.start(input, actor));
  assert.equal(job.status, "running");
  assert.equal((await clones.start(input, actor)).id, job.id);
  (await assert.rejects(async () => (await clones.start({ ...input, name: "changed" }, actor)), /已提交/));
  (await assert.rejects(async () => (await clones.start({ ...input, requestId: randomUUID() }, actor)), /正在克隆/));
  assert.deepEqual((await clones.list(other)), []);
  (await assert.rejects(async () => (await clones.read(job.id, other)), /不存在/));
  (await assert.rejects(async () => (await clones.dismiss(job.id, actor)), /尚未结束/));
  await tick();
  assert.equal(pending.length, 1);
  await pending[0].onProgress({ stage: "receiving", percent: 37 });
  const observer = new WorkspaceCloneManager(database, workspaces);
  assert.equal((await observer.read(job.id, actor)).progress.percent, 37);
  assert.equal((await observer.read(job.id, actor)).status, "running", "another server must not interrupt a live worker");
  pending[0].finish();
  const completed = await waitForClone(async () => (await clones.read(job.id, actor)));
  assert.equal(completed.status, "completed");
  assert.equal((await workspaces.read(completed.workspace.id, actor)).name, input.name);
  assert.doesNotMatch(JSON.stringify(completed), /secret-clone-password|password|remoteUrl|worker_pid/);
  (await assert.rejects(async () => (await clones.dismiss(job.id, other)), /不存在/));
  (await clones.dismiss(job.id, actor));
  assert.deepEqual((await clones.list(actor)), []);
  assert.equal((await clones.start(input, actor)).id, job.id, "retries must not reclone a completed request");
  await observer.close();
});

test("shutdown and account revocation interrupt publication without creating a workspace", async t => {
  const { accounts, actor, other, clones, workspaces, pending, input, tick } = await fixture(t);
  const interrupted = (await clones.start(input, actor));
  await tick();
  await clones.close();
  assert.equal((await clones.read(interrupted.id, actor)).status, "interrupted");
  assert.deepEqual((await workspaces.list(actor)), []);
  const second = new WorkspaceCloneManager(accounts.database, workspaces);
  t.after(() => second.close());
  const job = (await second.start({ ...input, requestId: randomUUID() }, actor));
  await tick();
  await accounts.update(other.id, { role: "admin" }, actor);
  await accounts.update(actor.id, { status: "disabled" }, other);
  pending.at(-1).finish();
  const ended = await waitForClone(async () => (await second.read(job.id, actor)));
  assert.equal(ended.status, "failed");
  assert.match(ended.error, /停用/);
  assert.deepEqual((await workspaces.list(actor)), []);
});

test("dead workers are reported as interrupted without replaying or deleting project directories", async t => {
  const { database, actor, clones, workspaces, input } = await fixture(t);
  const { row } = (await clones.store.create(actor.id, input));
  const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8", windowsHide: true }));
  await database.client.workspaceClone.update({ where: { id: row.id }, data: { workerPid: deadPid } });
  const recovered = new WorkspaceCloneManager(database, workspaces);
  assert.equal((await recovered.read(row.id, actor)).status, "interrupted");
  assert.equal(recovered.active.size, 0);
  await recovered.close();
});

test("production HTTP refuses personal clones and conceals legacy background job endpoints", async t => {
  let app;
  t.after(() => app?.close());
  const { database, workspaces, clones, input, pending } = await fixture(t);
  app = createWebServer({ database, workspaces, workspaceClones: clones });
  const origin = await app.listen(0);
  const bootstrap = await fetch(origin + "/api/auth/session");
  let cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0] || "";
  let token = (await bootstrap.json()).token;
  const login = await fetch(origin + "/api/auth/login", { method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": token }, body: JSON.stringify({ username: "admin", password: "clone-fixture" }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")?.split(";", 1)[0] || cookie;
  token = (await login.json()).token;
  const create = await fetch(origin + "/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json", "x-csrf-token": token }, body: JSON.stringify(input) });
  assert.equal(create.status, 403);
  assert.match((await create.json()).error, /个人空间创建已关闭/);
  assert.equal(pending.length, 0);
  const jobs = await fetch(origin + "/api/workspace-clones", { headers: { cookie } });
  assert.deepEqual((await jobs.json()).clones, []);
  const job = await fetch(origin + "/api/workspace-clones/" + randomUUID(), { headers: { cookie } });
  assert.equal(job.status, 404);
});
