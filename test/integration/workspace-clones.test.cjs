const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { setImmediate } = require("node:timers");
const { temporary } = require("../support/helpers.cjs");
const { waitForClone } = require("../support/workspace-clones.cjs");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { GitAccountServices } = require("../../src/application/git-account-services.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { WorkspaceCloneManager } = require("../../src/application/workspace-clone-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

async function fixture(t) {
  let database, accounts, clones;
  t.after(async () => { await clones?.close(); await accounts?.close(); database?.close(); });
  const directory = temporary(t);
  database = await initializeDatabase(directory);
  accounts = new AccountServices(database);
  const actor = await accounts.create({ username: "admin", password: "clone-fixture" }, null, true);
  const other = await accounts.create({ username: "member", password: "clone-fixture" }, actor);
  const git = new GitAccountServices(database, { checkConnection: async () => {} });
  const account = await git.save(actor, { name: "Fixture Git", authType: "http", remoteUrl: "http://git.example.test/team/project.git", username: "fixture", password: "secret-clone-password" });
  const pending = [];
  const workspaces = new WorkspaceManager({ database, directory: path.join(directory, "workspaces"),
    cloneProject: options => new Promise((resolve, reject) => {
      pending.push({ ...options, finish: () => { try { resolve(options.publish()); } catch (error) { reject(error); } }, fail: reject });
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  clones = new WorkspaceCloneManager(database, workspaces);
  const input = { requestId: randomUUID(), name: "项目", gitAccountId: account.id, remoteUrl: account.remoteUrl };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return { database, accounts, actor, other, workspaces, clones, pending, input, tick };
}

test("clone jobs persist progress, isolate owners, deduplicate requests and publish atomically", async t => {
  const { database, actor, other, clones, workspaces, pending, input, tick } = await fixture(t);
  const job = clones.start(input, actor);
  assert.equal(job.status, "running");
  assert.equal(clones.start(input, actor).id, job.id);
  assert.throws(() => clones.start({ ...input, name: "changed" }, actor), /已提交/);
  assert.throws(() => clones.start({ ...input, requestId: randomUUID() }, actor), /正在克隆/);
  assert.deepEqual(clones.list(other), []);
  assert.throws(() => clones.read(job.id, other), /不存在/);
  assert.throws(() => clones.dismiss(job.id, actor), /尚未结束/);
  await tick();
  assert.equal(pending.length, 1);
  pending[0].onProgress({ stage: "receiving", percent: 37 });
  const observer = new WorkspaceCloneManager(database, workspaces);
  assert.equal(observer.read(job.id, actor).progress.percent, 37);
  assert.equal(observer.read(job.id, actor).status, "running", "another server must not interrupt a live worker");
  pending[0].finish();
  const completed = await waitForClone(() => clones.read(job.id, actor));
  assert.equal(completed.status, "completed");
  assert.equal(workspaces.read(completed.workspace.id, actor).name, input.name);
  assert.doesNotMatch(JSON.stringify(completed), /secret-clone-password|password|remoteUrl|worker_pid/);
  assert.throws(() => clones.dismiss(job.id, other), /不存在/);
  clones.dismiss(job.id, actor);
  assert.deepEqual(clones.list(actor), []);
  assert.equal(clones.start(input, actor).id, job.id, "retries must not reclone a completed request");
  await observer.close();
});

test("shutdown and account revocation interrupt publication without creating a workspace", async t => {
  const { accounts, actor, other, clones, workspaces, pending, input, tick } = await fixture(t);
  const interrupted = clones.start(input, actor);
  await tick();
  await clones.close();
  assert.equal(clones.read(interrupted.id, actor).status, "interrupted");
  assert.deepEqual(workspaces.list(actor), []);
  const second = new WorkspaceCloneManager(accounts.database, workspaces);
  t.after(() => second.close());
  const job = second.start({ ...input, requestId: randomUUID() }, actor);
  await tick();
  await accounts.update(other.id, { role: "admin" }, actor);
  await accounts.update(actor.id, { status: "disabled" }, other);
  pending.at(-1).finish();
  const ended = await waitForClone(() => second.read(job.id, actor));
  assert.equal(ended.status, "failed");
  assert.match(ended.error, /停用/);
  assert.deepEqual(workspaces.list(actor), []);
});

test("dead workers are reported as interrupted without replaying or deleting project directories", async t => {
  const { database, actor, clones, workspaces, input } = await fixture(t);
  const { row } = clones.store.create(actor.id, input);
  const deadPid = Number(execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8", windowsHide: true }));
  database.handle.prepare("UPDATE workspace_clones SET worker_pid=? WHERE id=?").run(deadPid, row.id);
  const recovered = new WorkspaceCloneManager(database, workspaces);
  assert.equal(recovered.read(row.id, actor).status, "interrupted");
  assert.equal(recovered.active.size, 0);
  await recovered.close();
});

test("HTTP accepts clones immediately and reconnecting after logout restores progress", async t => {
  let app;
  t.after(() => app?.close());
  const { database, actor, workspaces, clones, pending, input, tick } = await fixture(t);
  app = createWebServer({ database, workspaces, workspaceClones: clones });
  const origin = await app.listen(0);
  let cookie = "", token = "";
  async function request(url, data) {
    const response = await fetch(origin + url, { method: data === undefined ? "GET" : "POST", headers: { cookie, "content-type": "application/json", "x-tapd-token": token }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || cookie;
    const body = await response.json();
    token = body.token || token;
    return { response, body };
  }
  async function login() {
    await request("/api/auth/session");
    const result = await request("/api/auth/login", { username: "admin", password: "clone-fixture" });
    assert.equal(result.response.status, 200);
  }
  await login();
  const accepted = await request("/api/workspaces", input);
  assert.equal(accepted.response.status, 202);
  const id = accepted.body.clone.id;
  await tick();
  pending[0].onProgress({ stage: "receiving", percent: 42 });
  await request("/api/auth/logout", {});
  assert.equal((await request(`/api/workspace-clones/${id}`)).response.status, 401);
  pending[0].finish();
  assert.equal((await waitForClone(() => clones.read(id, actor))).status, "completed");
  await login();
  const restored = await request("/api/workspace-clones");
  assert.equal(restored.body.clones[0].status, "completed");
  assert.equal(restored.body.clones[0].id, id);
});
