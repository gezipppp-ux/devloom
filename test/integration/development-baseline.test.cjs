const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { git } = require("../../src/git/command.cjs");
const { runExecution } = require("../../src/execution/runner.cjs");
const { fetchDevelopmentBaseline } = require("../../src/git/development-baseline.cjs");
const { worktreePlan } = require("../../src/git/worktrees.cjs");
const { ExecutionStore } = require("../../src/storage/execution-store.cjs");
const { worktreeReason } = require("../../src/git/worktree-access.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { SessionViews } = require("../../src/application/session-views.cjs");
const { runKey, sourceFor } = require("../../src/domain/run-identity.cjs");
const { temporary } = require("../support/helpers.cjs");
const { randomUUID } = require("node:crypto");
const { setImmediate } = require("node:timers");
const { SessionManager } = require("../support/session-manager.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");

function fixture(t) {
  const root = temporary(t);
  const remote = path.join(root, "remote.git");
  const author = path.join(root, "author");
  const repository = path.join(root, "clone");
  git(root, ["init", "--bare", remote]);
  git(root, ["init", "-b", "main", author]);
  git(author, ["config", "user.name", "Fixture"]);
  git(author, ["config", "user.email", "fixture@example.test"]);
  const commit = (value) => {
    fs.writeFileSync(path.join(author, "file.txt"), value);
    git(author, ["add", "."]);
    git(author, ["commit", "-m", value]);
    return git(author, ["rev-parse", "HEAD"]);
  };
  const original = commit("original");
  git(author, ["remote", "add", "origin", remote]);
  git(author, ["push", "origin", "main"]);
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(root, ["clone", remote, repository]);
  let starts = 0;
  const input = (id = "1", branch = "main") => ({
    config: { agent: { provider: "codex" }, execution: { repository, baseBranch: branch, worktreeRoot: path.join(root, "trees") } },
    configFile: path.join(root, "config.json"),
    item: { id, workspace_id: "scope" }, directory: path.join(root, `run-${id}`),
    channel: {
      id: "fixture",
      prepare: async ({ item }) => ({ workitem: item, task: { images: [], prompt: "fixture", execution_ready: true } }),
      transition: async () => ({ status: "skipped" }),
    },
  });
  const dependencies = { startSession: async ({ onSession, onStarted }) => {
    starts++; await onSession("fixture"); await onStarted(); return { completed: true };
  } };
  return { root, remote, author, repository, original, commit, input, dependencies, starts: () => starts };
}

test("explicit preparation retry preserves snapshots and identities, fences active work, and never redispatches an accepted request", async t => {
  const f = fixture(t), input = f.input("retry");
  const key = runKey(sourceFor(input.channel.id, input.item)), runs = path.join(f.root, "runs");
  fs.writeFileSync(input.configFile, JSON.stringify(input.config));
  input.directory = path.join(runs, key);
  const image = path.join(input.directory, "fixture.png");
  fs.mkdirSync(input.directory, { recursive: true });
  fs.writeFileSync(image, "original image bytes");
  const task = { prompt: "original immutable task", images: [{ path: image }], execution_ready: true };
  input.channel.prepare = async () => ({ workitem: input.item, task, worktreeSlug: "original-title" });
  await assert.rejects(runExecution(input, { ...f.dependencies, fetchDevelopmentBaseline: async () => { throw new Error("fetch timeout"); } }), /fetch timeout/);
  const before = await new RunStore(runs).read(key);
  let attempts = 0;
  const client = new FakeClient();
  const originalRequest = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await originalRequest(method, params);
    if (method === "turn/start") setImmediate(() => client.notify("turn/completed", { threadId: params.threadId, turn: { ...result.turn, status: "completed" } }));
    return result;
  };
  input.channel.prepare = () => assert.fail("retry must not regenerate the original task");
  const manager = new SessionManager({ runsDirectory: runs, configFile: input.configFile, client,
    channels: { get: id => { assert.equal(id, "fixture"); return input.channel; } },
    run: async (args, dependencies) => { attempts++; return runExecution(args, dependencies); },
  });
  t.after(() => manager.close());
  await manager.store.writeWeb(key, { turnId: "pending-turn" });
  await assert.rejects(manager.retryPreparation(key, randomUUID()), /不能重新启动/);
  await manager.store.writeWeb(key, {});
  await manager.store.archive(key);
  await assert.rejects(manager.retryPreparation(key, randomUUID()), /不能重新启动/);
  await manager.store.restore(key);
  await assert.rejects(manager.retryPreparation(key, "invalid"), /标识无效/);
  await assert.rejects(manager.retryPreparation(key, randomUUID(), () => { throw new Error("revision changed"); }), /revision changed/);
  const validateSelection = manager.validateStartSelection.bind(manager);
  manager.validateStartSelection = async () => { throw new Error("original model unavailable"); };
  await assert.rejects(manager.retryPreparation(key, randomUUID()), /original model unavailable/);
  manager.validateStartSelection = validateSelection;
  assert.equal(attempts, 0);
  const requestId = randomUUID();
  await manager.retryPreparation(key, requestId);
  assert.equal((await manager.retryPreparation(key, requestId)).reused, true);
  await assert.rejects(manager.retryPreparation(key, randomUUID()), /不能重新启动/);
  await manager.sessions.get(key).operation;
  const state = await manager.store.read(key);
  assert.equal(state.execution.status, "completed", state.execution.error);
  assert.equal(attempts, 1);
  assert.equal(state.created_at, before.created_at);
  assert.deepEqual(state.source, before.source);
  assert.deepEqual(state.workitem, before.workitem);
  assert.equal(state.preparationRetries[0].requestId, requestId);
  assert.equal(state.preparationRetries[0].previousExecution.error, "fetch timeout");
  const sent = client.calls.find(call => call.method === "turn/start");
  assert.equal(sent.params.input[0].text, task.prompt);
  assert.equal(sent.params.input.length, 2);
  assert.deepEqual(await manager.store.readTask(key), task);
  assert.equal((await manager.retryPreparation(key, requestId)).reused, true);
  await assert.rejects(manager.retryPreparation(key, randomUUID()), /不能重新启动/);
  await manager.close();
  const reloaded = new SessionManager({ runsDirectory: runs, configFile: input.configFile, client: new FakeClient() });
  t.after(() => reloaded.close());
  assert.equal((await reloaded.retryPreparation(key, requestId)).reused, true);
  assert.equal(attempts, 1);
});

test("failed worktree initialization retries in the same real worktree before starting the Agent", async t => {
  const f = fixture(t), input = f.input("initialization-retry");
  fs.writeFileSync(path.join(f.author, "init.cjs"), 'const fs = require("node:fs"); fs.appendFileSync("attempts.txt", "attempt\\n"); if (!fs.existsSync("ready.txt")) process.exit(1);');
  git(f.author, ["add", "init.cjs"]);
  git(f.author, ["commit", "-m", "add initialization"]);
  git(f.author, ["push", "origin", "main"]);
  input.config.execution.initCommands = ["node init.cjs"];
  fs.writeFileSync(input.configFile, JSON.stringify(input.config));
  const key = runKey(sourceFor(input.channel.id, input.item)), runs = path.join(f.root, "runs");
  input.directory = path.join(runs, key);
  await assert.rejects(runExecution(input, f.dependencies), /初始化第 1 条命令失败/);
  const before = await new RunStore(runs).read(key);
  assert.equal(before.initialization.status, "failed");
  assert.equal(f.starts(), 0);
  fs.writeFileSync(path.join(before.worktree.path, "ready.txt"), "resolved");
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await request(method, params);
    if (method === "turn/start") setImmediate(() => client.notify("turn/completed", { threadId: params.threadId, turn: { ...result.turn, status: "completed" } }));
    return result;
  };
  const manager = new SessionManager({ runsDirectory: runs, configFile: input.configFile, client,
    channels: { get: () => input.channel } });
  t.after(() => manager.close());
  const requestId = randomUUID();
  await manager.retryPreparation(key, requestId);
  await manager.sessions.get(key).operation;
  const after = await manager.store.read(key);
  assert.equal(after.execution.status, "completed", after.execution.error);
  assert.equal(after.initialization.status, "completed");
  assert.deepEqual(after.worktree, before.worktree);
  assert.equal(fs.readFileSync(path.join(before.worktree.path, "attempts.txt"), "utf8"), "attempt\nattempt\n");
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 1);
  assert.equal((await manager.retryPreparation(key, requestId)).reused, true);
});

test("new worktrees fetch current remote commits without changing dirty source checkout; existing runs never refetch", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repository, "file.txt"), "dirty source");
  fs.writeFileSync(path.join(f.repository, "untracked.txt"), "keep");
  const latest = f.commit("new remote commit");
  git(f.author, ["push", "origin", "main"]);
  const state = await runExecution(f.input(), f.dependencies);
  assert.equal(state.worktree.base_commit, latest);
  assert.deepEqual(state.worktree.baseline, { remote: "origin", branch: "main", commit: latest, fetchedAt: state.worktree.baseline.fetchedAt });
  assert.ok(Number.isFinite(Date.parse(state.worktree.baseline.fetchedAt)));
  assert.equal(git(state.worktree.path, ["rev-parse", "HEAD"]), latest);
  assert.equal(git(f.repository, ["rev-parse", "HEAD"]), f.original);
  assert.equal(fs.readFileSync(path.join(f.repository, "file.txt"), "utf8"), "dirty source");
  assert.equal(fs.readFileSync(path.join(f.repository, "untracked.txt"), "utf8"), "keep");
  git(f.repository, ["remote", "remove", "origin"]);
  assert.equal((await runExecution(f.input(), f.dependencies)).reused, true);
  assert.equal(f.starts(), 1);
});

test("non-default branches and force-pushed commits are fetched by exact branch", async (t) => {
  const f = fixture(t);
  git(f.author, ["checkout", "-b", "feature/task"]);
  const latest = f.commit("feature");
  git(f.author, ["push", "origin", "feature/task"]);
  const state = await runExecution(f.input("1", "feature/task"), f.dependencies);
  assert.equal(state.worktree.base_commit, latest);
  git(f.author, ["reset", "--hard", f.original]);
  git(f.author, ["push", "--force", "origin", "feature/task"]);
  const next = await runExecution(f.input("2", "feature/task"), f.dependencies);
  assert.equal(next.worktree.base_commit, f.original);
  assert.equal(git(f.repository, ["branch", "--show-current"]), "main");
});

test("deleted branches and unreachable remotes never fall back to stale tracking refs or start sessions", async (t) => {
  const f = fixture(t);
  git(f.author, ["push", "origin", "main:removed"]);
  await fetchDevelopmentBaseline(f.repository, "removed");
  git(f.author, ["push", "origin", ":removed"]);
  await assert.rejects(runExecution(f.input("1", "removed"), f.dependencies), /获取开发基准分支失败/);
  git(f.repository, ["remote", "set-url", "origin", path.join(f.root, "missing.git")]);
  await assert.rejects(runExecution(f.input("2"), f.dependencies), /获取开发基准分支失败/);
  assert.equal(f.starts(), 0);
  assert.equal(fs.existsSync(path.join(f.root, "trees")), false);
  for (const [id, branch] of [["1", "removed"], ["2", "main"]]) {
    const state = await new ExecutionStore(f.input(id).directory).read();
    assert.equal(state.execution.status, "failed");
    assert.match(state.execution.error, /获取开发基准分支失败/);
    assert.equal(state.worktree.path, undefined);
    assert.deepEqual(state.worktree.baseline, { remote: "origin", branch, commit: null, fetchedAt: null });
    assert.equal(worktreeReason(state), "尚未创建工作区");
    const reused = await runExecution(f.input(id, branch), { ...f.dependencies,
      fetchDevelopmentBaseline: () => { assert.fail("failed preparation must not fetch again"); },
    });
    assert.equal(reused.reused, true);
    assert.equal(reused.execution.error, state.execution.error);
  }
});

test("shared repository lock fences concurrent creation and authorization revocation prevents creation", async (t) => {
  const f = fixture(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const first = runExecution(f.input(), { ...f.dependencies, authorize: async () => { entered(); await gate; } });
  await ready;
  await assert.rejects(runExecution(f.input("2"), f.dependencies), /已有 Git 操作/);
  release();
  await first;
  let checks = 0;
  await assert.rejects(runExecution(f.input("3"), { ...f.dependencies, authorize: async () => {
    if (++checks === 2) throw new Error("revoked");
  } }), /revoked/);
  assert.equal(f.starts(), 1);
});

test("aborted preparation and remote mismatch fail before sending credentials", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runExecution(f.input(), { ...f.dependencies, signal: controller.signal }), /已停止/);
  await assert.rejects(fetchDevelopmentBaseline(f.repository, "main", {
    credentials: { account: { password: "secret" }, remoteUrl: "https://example.test/repo.git" },
  }), /远端地址已变更/);
  assert.equal(f.starts(), 0);
});

test("a task keeps its fetched SHA when a tracking reference changes before planning", async (t) => {
  const f = fixture(t);
  const latest = f.commit("latest");
  git(f.author, ["push", "origin", "main"]);
  const state = await runExecution(f.input(), { ...f.dependencies, worktreePlan: (repository, item, commit, options) => {
    git(repository, ["update-ref", "refs/remotes/origin/main", f.original]);
    return worktreePlan(repository, item, commit, options);
  } });
  assert.equal(state.worktree.baseline.commit, latest);
  assert.equal(state.worktree.base_commit, latest);
  assert.equal(git(state.worktree.path, ["rev-parse", "HEAD"]), latest);
});

test("cancellation after fetch prevents worktree creation and session startup", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  let checks = 0;
  await assert.rejects(runExecution(f.input(), { ...f.dependencies, signal: controller.signal,
    authorize: async () => { if (++checks === 2) controller.abort(); },
  }), /已停止/);
  assert.equal(f.starts(), 0);
  assert.equal(fs.existsSync(path.join(f.root, "trees")), false);
});

test("fetch preparation failure remains visible in a reloaded read-only session", async (t) => {
  const f = fixture(t);
  const input = f.input("failed", "missing");
  const key = runKey(sourceFor(input.channel.id, input.item));
  const runs = path.join(f.root, "runs");
  input.directory = path.join(runs, key);
  await assert.rejects(runExecution(input, f.dependencies), /获取开发基准分支失败/);
  const views = new SessionViews({ store: new RunStore(runs), sessions: new Map(),
    worktreeReason, assertOpen: () => {},
  });
  const view = await views.view(key);
  assert.equal(view.status, "failed");
  assert.match(view.error, /获取开发基准分支失败/);
  assert.equal(view.readOnlyReason, "尚未创建工作区");
  assert.equal(view.worktree.path, undefined);
  assert.equal(view.worktree.baseline.branch, "missing");
  assert.equal((await views.list())[0].execution.status, "failed");
});
