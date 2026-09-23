const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { setImmediate } = require("node:timers/promises");
const { temporary, png } = require("../support/helpers.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { saveState } = require("../../src/storage/run-state.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { forceDeleteTaskWorktree } = require("../../src/git/task-operations.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

async function fixture(t) {
  const cleanup = [];
  const root = temporary({ after: (callback) => cleanup.push(callback) });
  const database = await initializeDatabase(root);
  let manager;
  t.after(async () => {
    await manager?.close();
    database.close();
    for (const callback of cleanup.reverse()) callback();
  });
  const repository = path.join(root, "repository");
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "original");
  fs.writeFileSync(path.join(repository, ".gitignore"), "ignored/\n");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  const tree = path.join(root, "task");
  const branch = "codex/delete-fixture";
  git("worktree", "add", "-b", branch, tree, "HEAD");
  const client = new FakeClient();
  manager = new SessionManager({ runsDirectory: path.join(root, "runs"), configFile: path.join(root, "config.json"), client });
  const key = "1-2";
  const state = { workitem: { id: "2", workspace_id: "1", title: "Delete fixture" },
    session_id: "original", execution: { status: "completed" },
    worktree: { repository, path: tree, branch } };
  saveState(path.join(manager.store.dir(key), "run.json"), state);
  manager.store.saveHistoryItem(key, { id: "old", type: "agentMessage", text: "history" });
  manager.store.messageImages(key).save(png);
  const input = { confirm: true, force: true, confirmBranch: branch };
  return { root, database, repository, tree, branch, git, client, manager, key, state, input };
}

test("force session deletion discards dirty, untracked, ignored and unpublished local content through HTTP", async (t) => {
  const f = await fixture(t);
  execFileSync("git", ["-C", f.tree, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "local-only"], { windowsHide: true, stdio: "ignore" });
  fs.writeFileSync(path.join(f.tree, "tracked.txt"), "uncommitted");
  fs.writeFileSync(path.join(f.tree, "untracked.txt"), "untracked");
  fs.mkdirSync(path.join(f.tree, "ignored"));
  fs.writeFileSync(path.join(f.tree, "ignored", "build.bin"), "ignored");
  const app = createWebServer({ manager: f.manager, configFile: f.manager.configFile, testIdentity: true });
  t.after(() => app.close());
  const origin = await app.listen(0);
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  const post = (input, headers = {}) => fetch(`${origin}/api/runs/${f.key}/delete`, {
    method: "POST", headers: { "content-type": "application/json", "x-tapd-token": token, ...headers },
    body: JSON.stringify(input),
  });
  assert.equal((await post(f.input, { "x-tapd-token": "wrong" })).status, 403);
  for (const input of [{ ...f.input, confirm: false }, { ...f.input, force: "true" },
    { ...f.input, confirmBranch: "main" }, { ...f.input, path: f.repository }, { confirm: true }]) {
    assert.equal((await post(input)).status, 400);
    assert.equal(fs.existsSync(f.tree), true);
    assert.equal(f.manager.store.hasRun(f.key), true);
  }
  const response = await post(f.input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(fs.existsSync(f.tree), false);
  assert.equal(f.git("branch", "--list", f.branch), "");
  assert.equal(fs.readFileSync(path.join(f.repository, "tracked.txt"), "utf8"), "original");
  for (const table of ["runs", "run_documents", "session_items", "log_chunks", "attachments"])
    assert.equal(f.database.handle.prepare(`SELECT count(*) AS total FROM ${table}`).get().total, 0, table);
});

test("force deletion clears an unregistered leftover directory and its recorded branch", async (t) => {
  const f = await fixture(t);
  f.git("worktree", "remove", "--force", f.tree);
  fs.mkdirSync(f.tree);
  fs.writeFileSync(path.join(f.tree, "leftover.log"), "leftover");
  fs.symlinkSync(f.repository, path.join(f.tree, "dependency-link"), process.platform === "win32" ? "junction" : "dir");
  await f.manager.deleteSession(f.key, f.input);
  assert.equal(fs.existsSync(f.tree), false);
  assert.equal(f.git("branch", "--list", f.branch), "");
  assert.equal(fs.readFileSync(path.join(f.repository, "tracked.txt"), "utf8"), "original");
});

test("force deletion removes leftover files from a partially removed registered Worktree", async (t) => {
  const f = await fixture(t);
  fs.unlinkSync(path.join(f.tree, ".git"));
  fs.writeFileSync(path.join(f.tree, "leftover.log"), "partial cleanup");
  await f.manager.deleteSession(f.key, f.input);
  assert.equal(fs.existsSync(f.tree), false);
  assert.equal(f.git("worktree", "list", "--porcelain").includes(f.branch), false);
  assert.equal(f.git("branch", "--list", f.branch), "");
});

test("force cleanup refuses a directory replaced after deletion intent is saved", async (t) => {
  const f = await fixture(t);
  let moved = false;
  const saved = path.join(f.root, "original-task");
  await assert.rejects(forceDeleteTaskWorktree(f.state, {}, () => {
    if (moved) return;
    assert.equal(path.dirname(f.tree), f.root);
    assert.equal(path.dirname(saved), f.root);
    fs.renameSync(f.tree, saved);
    fs.mkdirSync(f.tree);
    fs.writeFileSync(path.join(f.tree, "keep.txt"), "replacement");
    moved = true;
  }), /目录已被替换/);
  assert.equal(fs.readFileSync(path.join(f.tree, "keep.txt"), "utf8"), "replacement");
  assert.equal(fs.existsSync(saved), true);
});

test("force cleanup preserves a branch changed after deletion intent is saved", async (t) => {
  const f = await fixture(t);
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "new commit");
  const head = f.git("rev-parse", "HEAD");
  await assert.rejects(forceDeleteTaskWorktree(f.state, {}, () => {
    f.git("update-ref", `refs/heads/${f.branch}`, head);
  }), /分支在清理期间发生变化/);
  assert.equal(fs.existsSync(f.tree), true);
  assert.equal(f.git("rev-parse", f.branch), head);
});

test("force deletion cleans a stale registration when the local directory is already missing", async (t) => {
  const f = await fixture(t);
  assert.equal(path.dirname(path.resolve(f.tree)), path.resolve(f.root));
  fs.rmSync(f.tree, { recursive: true, force: true });
  await f.manager.deleteSession(f.key, f.input);
  assert.equal(f.git("worktree", "list", "--porcelain").includes(f.branch), false);
  assert.equal(f.git("branch", "--list", f.branch), "");
});

test("force deletion refuses running tasks, foreign owners, active Codex and Git locks", async (t) => {
  const f = await fixture(t);
  const runtime = f.manager.runtime(f.key, "original");
  runtime.turnId = "running";
  await assert.rejects(f.manager.deleteSession(f.key, f.input), /正在执行/);
  runtime.turnId = null;
  const peer = new SessionManager({ runsDirectory: path.join(f.root, "runs"), client: new FakeClient() });
  t.after(() => peer.close());
  peer.store.claim(f.key);
  await assert.rejects(f.manager.deleteSession(f.key, f.input), /另一个 Web/);
  peer.store.release(f.key);
  const request = f.client.request.bind(f.client);
  f.client.request = async (method, params) => method === "thread/read" ? { thread: { status: { type: "active" } } } : request(method, params);
  await assert.rejects(f.manager.deleteSession(f.key, f.input), /无法确认 Codex/);
  f.client.request = request;
  f.git("worktree", "lock", f.tree);
  await assert.rejects(f.manager.deleteSession(f.key, f.input), /锁定/);
  f.git("worktree", "unlock", f.tree);
  assert.equal(fs.existsSync(f.tree), true);
  assert.equal(f.manager.store.hasRun(f.key), true);
});

test("force cleanup refuses main/ancestor directories, switched branches and replacement links", async (t) => {
  const f = await fixture(t);
  for (const location of [f.repository, f.root])
    await assert.rejects(forceDeleteTaskWorktree({ ...f.state, worktree: { ...f.state.worktree, path: location } }), /主目录|包含仓库/);
  execFileSync("git", ["-C", f.tree, "checkout", "-b", "other"], { windowsHide: true, stdio: "ignore" });
  await assert.rejects(f.manager.deleteSession(f.key, f.input), /不再属于任务分支/);
  execFileSync("git", ["-C", f.tree, "checkout", f.branch], { windowsHide: true, stdio: "ignore" });
  f.git("worktree", "remove", "--force", f.tree);
  fs.symlinkSync(f.repository, f.tree, process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(f.manager.deleteSession(f.key, f.input), /符号链接/);
    assert.equal(fs.readFileSync(path.join(f.repository, "tracked.txt"), "utf8"), "original");
  } finally { fs.unlinkSync(f.tree); }
});

test("failed branch cleanup retains the session and can be retried", async (t) => {
  const f = await fixture(t);
  const branchLock = path.join(f.repository, ".git", "refs", "heads", "codex", "delete-fixture.lock");
  fs.writeFileSync(branchLock, "fixture lock");
  try {
    await assert.rejects(f.manager.deleteSession(f.key, f.input), /强制清理未完成/);
    assert.equal(f.manager.store.hasRun(f.key), true);
    assert.equal(f.manager.store.readWorktreeDeletion(f.key).status, "partial");
    assert.equal(fs.existsSync(f.tree), false);
  } finally { fs.unlinkSync(branchLock); }
  await f.manager.deleteSession(f.key, f.input);
  assert.equal(f.manager.store.hasRun(f.key), false);
  assert.equal(f.git("branch", "--list", f.branch), "");
});

test("permanent deletion waits for delayed completion writes before clearing all history", async (t) => {
  const f = await fixture(t);
  const request = f.client.request.bind(f.client);
  let finishHistory;
  f.client.request = (method, params) => method === "thread/items/list"
    ? new Promise((resolve) => { finishHistory = resolve; }) : request(method, params);
  const runtime = f.manager.runtime(f.key, "original");
  Object.assign(runtime, { status: "running", turnId: "followup", connected: true });
  runtime.items.set("answer", { id: "answer", type: "agentMessage", turnId: "followup", text: "private history" });
  const completing = f.manager.events.completed(runtime, { id: "followup", status: "completed" });
  let deleted = false;
  const deleting = f.manager.deleteSession(f.key, f.input).then(() => { deleted = true; });
  await setImmediate();
  assert.equal(deleted, false);
  assert.equal(fs.existsSync(f.tree), true);
  finishHistory({ data: [{ turnId: "followup", item: { id: "answer", type: "agentMessage", text: "private history" } }], nextCursor: null });
  await Promise.all([completing, deleting]);
  for (const table of ["runs", "run_documents", "session_items", "log_chunks", "attachments"])
    assert.equal(f.database.handle.prepare(`SELECT count(*) AS total FROM ${table}`).get().total, 0, table);
});
