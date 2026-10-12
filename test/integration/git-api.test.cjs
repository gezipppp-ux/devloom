const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { temporary } = require("../support/helpers.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");
const { saveSettings } = require("../../src/config/execution-settings.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { seedWorkspaceProject } = require("../support/workspace-project.cjs");
const {
  withRepositoryOperation,
} = require("../../src/storage/git-operations.cjs");

function fixtureFetch(url, options = {}) {
  // Snapshot assertions run synchronous Git between requests. A fresh socket
  // avoids racing an expired keep-alive timer while that event loop is blocked.
  return fetch(url, {
    ...options,
    headers: { connection: "close", ...options.headers },
  });
}

async function fixture(t) {
  const directory = temporary(t);
  const repository = path.join(directory, "repository");
  fs.mkdirSync(repository);
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  fs.writeFileSync(path.join(repository, "README.md"), "fixture");
  git("add", ".");
  git("commit", "-m", "fixture");
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
    createManager: (options) =>
      new SessionManager({ ...options, client: new FakeClient() }),
  });
  (await saveSystemSettings(
    { memberStorageRoot: path.join(directory, "trees") },
    directory,
  ));
  const a = (await workspaces.save({ name: "Git fixture" }));
  const b = (await workspaces.save({ name: "Other workspace" }));
  (await seedWorkspaceProject(workspaces.configFile(a.id), repository));
  (await saveSettings(
    { baseBranch: "main" },
    workspaces.configFile(a.id),
  ));
  const manager = (await workspaces.get(a.id)).sessions;
  const key = "1-2";
  const tree = path.join(directory, "task");
  const branch = "codex/git-api-fixture";
  git("worktree", "add", "-b", branch, tree, "HEAD");
  const state = {
    source: { channel: "tapd", scope: "1", id: "2" },
    agent: { provider: "codex" },
    workitem: { title: "Git fixture", id: "2", workspace_id: "1" },
    worktree: {
      repository,
      path: tree,
      branch,
      base_commit: git("rev-parse", "HEAD"),
    },
    session_id: "original",
    execution: { status: "completed" },
    transition: { status: "succeeded" },
  };
  (await writeConfig(path.join(manager.store.dir(key), "run.json"), state));
  const app = createWebServer({ testIdentity: true, workspaces });
  t.after(() => app.close());
  const origin = await app.listen(0);
  const { token } = await (await fixtureFetch(`${origin}/api/bootstrap`)).json();
  const prefix = `${origin}/api/workspaces/${a.id}`;
  const post = (route, input, headers = {}) =>
    fixtureFetch(`${prefix}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": token,
        ...headers,
      },
      body: JSON.stringify(input),
    });
  const snapshot = () => manager.readGit(key);
  const confirmation = async () => {
    const status = await snapshot();
    return {
      expectedHead: status.head,
      statusToken: status.statusToken,
      confirmBranch: status.branch,
      discardChanges: true,
    };
  };
  const remove = async (input, headers) =>
    post(`/runs/${key}/worktree/delete`, input ?? await confirmation(), headers);
  return {
    directory,
    repository,
    git,
    workspaces,
    manager,
    state,
    key,
    tree,
    branch,
    a,
    b,
    origin,
    prefix,
    post,
    snapshot,
    confirmation,
    remove,
  };
}

test("delete API validates origin, scope, snapshot and risk acknowledgement without starting a turn", async (t) => {
  const f = await fixture(t);
  const { manager, key, tree, branch, snapshot, confirmation, remove } = f;
  assert.equal((await snapshot()).unpublished, true);
  assert.equal((await snapshot()).ahead, null);
  assert.equal(
    (await remove((await confirmation()), { "x-csrf-token": "wrong" })).status,
    403,
  );
  assert.equal(
    (await remove((await confirmation()), { origin: "https://elsewhere.invalid" }))
      .status,
    403,
  );
  assert.equal(
    (await fixtureFetch(`${f.origin}/api/workspaces/${f.b.id}/runs/${key}/git`))
      .status,
    404,
  );
  for (const input of [
    { ...(await confirmation()), confirmBranch: "main" },
    { ...(await confirmation()), discardChanges: false },
    { ...(await confirmation()), path: f.repository },
  ])
    assert.equal((await remove(input)).status, 400);
  const stale = (await confirmation());
  fs.writeFileSync(path.join(tree, "new.txt"), "keep");
  assert.equal((await remove(stale)).status, 400);
  assert.equal(fs.readFileSync(path.join(tree, "new.txt"), "utf8"), "keep");
  const runtime = manager.runtime(key, "original");
  runtime.status = "running";
  runtime.turnId = "active-turn";
  assert.equal((await snapshot()).canDelete, false);
  assert.equal((await remove()).status, 400);
  runtime.status = "completed";
  runtime.turnId = null;
  const lock = path.join(manager.store.dir(key), ".lock");
  fs.mkdirSync(lock);
  assert.equal((await remove()).status, 400);
  fs.rmdirSync(lock);
  const original = fs.readFileSync(
    path.join(manager.store.dir(key), "run.json"),
    "utf8",
  );
  const events = [];
  manager.on("event", (event) => events.push(event));
  assert.equal((await remove()).status, 200);
  assert.equal(fs.existsSync(tree), false);
  assert.throws(() => f.git("show-ref", "--verify", `refs/heads/${branch}`));
  assert.equal((await snapshot()).deleted, true);
  assert.equal((await manager.store.readWorktreeDeletion(key)).status, "deleted");
  assert.equal(
    fs.readFileSync(path.join(manager.store.dir(key), "run.json"), "utf8"),
    original,
  );
  const view = await manager.view(key);
  assert.match(view.readOnlyReason, /已删除/);
  assert.ok(view.items.some((item) => item.text === "历史回复"));
  await assert.rejects(manager.send(key, "cannot resume"), /已删除/);
  assert.ok(
    events.some(
      (event) =>
        event.type === "worktree" && event.deletion.status === "deleted",
    ),
  );
  assert.ok(
    manager.client.calls.every(
      ({ method }) =>
        !["turn/start", "thread/start", "thread/resume"].includes(method),
    ),
  );
  assert.equal((await remove({ ...stale, discardChanges: true })).status, 200);
});

test("delete refuses another Web owner and active external Codex session; repository mutations are serialized", async (t) => {
  const f = await fixture(t);
  const { manager, key, remove, tree } = f;
  (await writeConfig(path.join(manager.store.dir(key), "web-owner.json"), {
    pid: process.pid,
    token: "another-service",
  }));
  assert.equal((await remove()).status, 400);
  fs.unlinkSync(path.join(manager.store.dir(key), "web-owner.json"));
  const request = manager.client.request.bind(manager.client);
  manager.client.request = async (method, params) =>
    method === "thread/read"
      ? { thread: { status: { type: "active" } } }
      : request(method, params);
  assert.equal((await remove()).status, 400);
  manager.client.request = request;
  await withRepositoryOperation(
    f.git("rev-parse", "--path-format=absolute", "--git-common-dir"),
    async () => {
      assert.equal((await remove()).status, 400);
    },
  );
  assert.equal(fs.existsSync(tree), true);
  assert.equal((await manager.store.readWorktreeDeletion(key)).status, undefined);
});

test("repository HTTP fetch uses saved repository and configured remote; persists refresh timestamp", async (t) => {
  const f = await fixture(t);
  const remote = path.join(f.directory, "remote.git");
  execFileSync("git", ["init", "--bare", remote], {
    windowsHide: true,
    stdio: "pipe",
  });
  f.git("remote", "add", "origin", remote);
  f.git("push", "-u", "origin", "main");
  const status = await (await fixtureFetch(`${f.prefix}/repository/git`)).json();
  assert.equal(status.remote, "origin");
  assert.equal(status.canUpdate, true);
  assert.equal(status.lastFetchedAt, null);
  assert.equal(
    (
      await f.post("/repository/git/fetch", {
        remote: "origin",
        repository: f.directory,
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.post("/repository/git/fetch", { remote: "file:///untrusted" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.post(
        "/repository/git/fetch",
        { remote: "origin" },
        { "x-csrf-token": "wrong" },
      )
    ).status,
    403,
  );
  const fetched = await f.post("/repository/git/fetch", { remote: "origin" });
  assert.equal(fetched.status, 200);
  const result = await fetched.json();
  assert.ok(result.lastFetchedAt);
  assert.equal(
    (await (await fixtureFetch(`${f.prefix}/repository/git`)).json()).lastFetchedAt,
    result.lastFetchedAt,
  );
  assert.equal((await f.post("/repository/git/update", {})).status, 200);
  assert.equal(f.git("symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(fs.existsSync(f.tree), true);
});
