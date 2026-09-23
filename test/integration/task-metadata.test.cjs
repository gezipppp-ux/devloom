const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { temporary } = require("../support/helpers.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { validateTaskMetadata } = require("../../src/domain/task-metadata.cjs");

function seed(store, key, type = "story") {
  fs.mkdirSync(store.dir(key), { recursive: true });
  fs.writeFileSync(
    path.join(store.dir(key), "run.json"),
    JSON.stringify({
      source: { channel: "tapd", scope: "1", id: key.slice(2) },
      workitem: {
        title: "分类测试",
        workspace_id: "1",
        id: key.slice(2),
        type,
      },
      execution: { status: "completed" },
      transition: { status: "succeeded" },
      session_id: "existing-session",
      worktree: { path: "/original/tree", branch: "codex/original" },
    }),
  );
}

test("classification defaults do not infer human progress from execution; updates preserve run identity and snapshots", (t) => {
  const store = new RunStore(temporary(t));
  seed(store, "1-2");
  seed(store, "1-3", "bug");
  const file = path.join(store.dir("1-2"), "run.json");
  const raw = fs.readFileSync(file, "utf8");
  const client = new FakeClient();
  const manager = new SessionManager({ store, client });
  t.after(() => manager.close());
  assert.deepEqual(manager.list().find((entry) => entry.key === "1-2").metadata, {
    type: "requirement",
    progress: "in_progress",
  });
  assert.deepEqual(manager.list().find((entry) => entry.key === "1-3").metadata, {
    type: "bug",
    progress: "in_progress",
  });
  assert.equal(
    fs.existsSync(path.join(store.dir("1-2"), "task-metadata.json")),
    false,
  );
  const events = [];
  manager.on("event", (e) => events.push(e));
  manager.updateTaskMetadata("1-2", { type: "bug", progress: "review" });
  manager.updateTaskMetadata("1-2", { progress: "merge" });
  assert.deepEqual(store.readTaskMetadata("1-2"), {
    type: "bug",
    progress: "merge",
  });
  assert.deepEqual(new RunStore(store.directory).readTaskMetadata("1-2"), {
    type: "bug",
    progress: "merge",
  });
  assert.equal(fs.readFileSync(file, "utf8"), raw);
  assert.equal(client.calls.length, 0);
  assert.equal(events.at(-1).type, "metadata");
  assert.equal(events.at(-1).status, undefined);
  assert.throws(
    () => manager.updateTaskMetadata("1-99", { progress: "done" }),
    /ENOENT/,
  );
  assert.equal(fs.existsSync(store.dir("1-99")), false);
});

test("task metadata rejects unsupported keys and values before resolving a source", async (t) => {
  const directory = temporary(t);
  const manager = new SessionManager({
    runsDirectory: directory,
    client: new FakeClient(),
  });
  t.after(() => manager.close());
  manager.channels.get = () =>
    assert.fail("source must not be resolved for invalid metadata");
  for (const input of [
    null,
    [],
    "bug",
    { type: "unknown" },
    { type: null },
    { progress: "completed" },
    { progress: 0 },
    { status: "running" },
    { progress: "in_progress", source: {} },
  ]) {
    assert.throws(() => validateTaskMetadata(input), /任务|进度/);
    await assert.rejects(manager.start({ metadata: input }), /任务|进度/);
  }
  assert.equal(manager.store.owned.size, 0);
});

test("session title updates keep the requirement snapshot and run identity unchanged", async (t) => {
  const store = new RunStore(temporary(t));
  seed(store, "1-2");
  const file = path.join(store.dir("1-2"), "run.json");
  const raw = fs.readFileSync(file, "utf8");
  const manager = new SessionManager({ store, client: new FakeClient() });
  t.after(() => manager.close());
  const events = [];
  manager.on("event", (event) => events.push(event));

  assert.equal(manager.list()[0].title, "分类测试");
  assert.deepEqual(manager.updateTitle("1-2", "  新会话标题  "), {
    title: "新会话标题",
  });
  assert.equal((await manager.view("1-2")).title, "新会话标题");
  assert.equal(manager.list()[0].title, "新会话标题");
  assert.equal(store.read("1-2").workitem.title, "分类测试");
  assert.equal(fs.readFileSync(file, "utf8"), raw);
  assert.equal(events.at(-1).type, "title");
  assert.equal(events.at(-1).title, "新会话标题");
  assert.throws(() => manager.updateTitle("1-2", "   "), /请输入会话标题/);
  assert.throws(() => manager.updateTitle("1-2", "x".repeat(201)), /不能超过/);
});

test("archived sessions leave their record readable but disappear from the list; permanent deletion needs removed code", async (t) => {
  const store = new RunStore(temporary(t));
  seed(store, "1-2");
  const manager = new SessionManager({ store, client: new FakeClient() });
  t.after(() => manager.close());
  const events = [];
  manager.on("event", (event) => events.push(event));

  await manager.archive("1-2");
  assert.deepEqual(manager.list(), []);
  assert.equal((await manager.view("1-2")).title, "分类测试");
  assert.equal(events.at(-1).type, "archived");
  await assert.rejects(
    manager.deleteSession("1-2", { confirm: true }),
    /请先删除 Worktree/,
  );
  store.writeWorktreeDeletion("1-2", { status: "deleted", worktreeRemoved: true, branchDeleted: true });
  assert.deepEqual(await manager.deleteSession("1-2", { confirm: true }), { deleted: true });
  assert.equal(store.hasRun("1-2"), false);
  assert.equal(fs.existsSync(store.dir("1-2")), false);
  assert.equal(events.at(-1).type, "deleted");
});

test("metadata HTTP writes require token/origin, remain workspace scoped and emit metadata-only SSE", async (t) => {
  const workspaces = new WorkspaceManager({
    directory: temporary(t),
    createManager: (opts) =>
      new SessionManager({ ...opts, client: new FakeClient() }),
  });
  const a = workspaces.save({ name: "A" }),
    b = workspaces.save({ name: "B" });
  const first = workspaces.get(a.id).sessions,
    second = workspaces.get(b.id).sessions;
  seed(first.store, "1-2");
  seed(second.store, "1-2");
  const app = createWebServer({ testIdentity: true, workspaces });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  const route = `/api/workspaces/${a.id}/runs/1-2/metadata`;
  const post = (data, extra = {}, url = route) =>
    fetch(`${origin}${url}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tapd-token": boot.token,
        ...extra,
      },
      body: JSON.stringify(data),
    });
  assert.equal(
    (await post({ progress: "done" }, { "x-tapd-token": "bad" })).status,
    403,
  );
  assert.equal(
    (await post({ progress: "done" }, { origin: "https://foreign.invalid" }))
      .status,
    403,
  );
  assert.equal((await post({ progress: "unknown" })).status, 400);
  assert.equal(
    (await post({ progress: "done" }, {}, route.replace("/runs/1-2/", "/runs/1-99/"))).status,
    404,
  );
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(`${origin}/api/workspaces/${a.id}/events`, {
    signal: abort.signal,
  });
  const reader = response.body.getReader();
  await reader.read();
  const result = await post({ type: "other", progress: "on_hold" });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    metadata: { type: "other", progress: "on_hold" },
  });
  const event = Buffer.from((await reader.read()).value).toString();
  assert.match(event, /"type":"metadata"/);
  assert.doesNotMatch(event, /"status"|sessionId|turnId/);
  assert.equal(second.store.readTaskMetadata("1-2").progress, "in_progress");
  const runs = await (
    await fetch(`${origin}/api/workspaces/${a.id}/runs`)
  ).json();
  assert.equal(runs.runs[0].metadata.progress, "on_hold");
  assert.equal(first.client.calls.length, 0);
  abort.abort();
});

test("session title HTTP writes are scoped, validated and broadcast", async (t) => {
  const workspaces = new WorkspaceManager({
    directory: temporary(t),
    createManager: (opts) =>
      new SessionManager({ ...opts, client: new FakeClient() }),
  });
  const workspace = workspaces.save({ name: "A" });
  const sessions = workspaces.get(workspace.id).sessions;
  seed(sessions.store, "1-2");
  const app = createWebServer({ testIdentity: true, workspaces });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  const route = `${origin}/api/workspaces/${workspace.id}/runs/1-2/title`;
  const post = (title) => fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tapd-token": boot.token },
    body: JSON.stringify({ title }),
  });
  assert.equal((await post("")).status, 400);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(`${origin}/api/workspaces/${workspace.id}/events`, {
    signal: abort.signal,
  });
  const reader = response.body.getReader();
  await reader.read();
  const result = await post("可编辑的会话标题");
  assert.deepEqual(await result.json(), { title: "可编辑的会话标题" });
  const event = Buffer.from((await reader.read()).value).toString();
  assert.match(event, /"type":"title"/);
  assert.match(event, /"title":"可编辑的会话标题"/);
  const runs = await (await fetch(`${origin}/api/workspaces/${workspace.id}/runs`)).json();
  assert.equal(runs.runs[0].title, "可编辑的会话标题");
});

test("session archive and deletion HTTP actions remain scoped and require explicit confirmation", async (t) => {
  const workspaces = new WorkspaceManager({
    directory: temporary(t),
    createManager: (opts) => new SessionManager({ ...opts, client: new FakeClient() }),
  });
  const a = workspaces.save({ name: "A" });
  const b = workspaces.save({ name: "B" });
  const first = workspaces.get(a.id).sessions;
  const second = workspaces.get(b.id).sessions;
  seed(first.store, "1-2");
  seed(second.store, "1-2");
  const app = createWebServer({ testIdentity: true, workspaces });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  const post = (workspace, action, input) => fetch(
    `${origin}/api/workspaces/${workspace}/runs/1-2/${action}`,
    { method: "POST", headers: { "content-type": "application/json", "x-tapd-token": boot.token }, body: JSON.stringify(input) },
  );
  assert.equal((await post(a.id, "delete", {})).status, 400);
  const archived = await (await post(a.id, "archive", {})).json();
  assert.equal(typeof archived.archivedAt, "string");
  assert.deepEqual(first.list(), []);
  assert.equal(second.list().length, 1);
});
