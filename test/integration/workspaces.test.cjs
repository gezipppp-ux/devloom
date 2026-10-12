const { attachOrigin } = require("../support/baseline-origin.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixtureWorkspaceClones } = require("../support/workspace-clones.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { temporary, png, json } = require("../support/helpers.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { writeConfig, readOptional } = require("../../src/storage/json-files.cjs");
const { readSettings, saveSettings } = require("../../src/config/execution-settings.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");
const { worktreePlan } = require("../../src/git/worktrees.cjs");
const { sourceFor } = require("../../src/domain/run-identity.cjs");
const { runsPath } = require("../../src/config/runtime.cjs");
const { seedWorkspaceProject } = require("../support/workspace-project.cjs");
const {
  saveTapdSettings,
  readTapdSettings,
  checkTapdSettings,
} = require("../../src/channels/tapd/settings.cjs");

async function fixtures(t) {
  const directory = temporary(t);
  (await writeConfig(path.join(directory, "system-settings.json"), {
    version: 1,
    memberStorageRoot: path.join(directory, "trees"),
  }));
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
    createManager: (options) =>
      new SessionManager({ ...options, client: new FakeClient() }),
  });
  const a = (await workspaces.save({ name: "项目 A" })),
    b = (await workspaces.save({ name: "项目 B" }));
  const repository = path.join(directory, "repo");
  fs.mkdirSync(repository);
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "README.md"), "fixture");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "fixture",
  );
  attachOrigin(repository);
  const settings = {
    baseBranch: "main",
    initCommands: [],
  };
  for (const workspace of [a, b]) (await seedWorkspaceProject(workspaces.configFile(workspace.id), repository, `w-${workspace.id.slice(0, 8)}`));
  return { directory, workspaces, a, b, settings, git, repository };
}

test("workspaces isolate settings, credentials and restart state; names never become paths", async (t) => {
  const { workspaces, a, b, settings, directory } = (await fixtures(t));
  t.after(() => workspaces.close());
  (await saveSettings(settings, workspaces.configFile(a.id)));
  (await saveTapdSettings(workspaces.configFile(a.id), {
    workspaceId: "42",
    cookie: "dsc-token=secret-a; auth=private",
  }));
  assert.equal((await readSettings(workspaces.configFile(a.id))).model, undefined);
  (await assert.rejects(
    async () =>
      (await saveSettings({ ...settings, model: "a" }, workspaces.configFile(a.id))),
    /仅允许/,
  ));
  (await assert.rejects(
    async () =>
      (await saveSettings(
        { ...settings, reasoningEffort: "high" },
        workspaces.configFile(a.id),
      )),
    /仅允许/,
  ));
  assert.equal((await readSettings(workspaces.configFile(b.id))).baseBranch, "");
  assert.equal((await readTapdSettings(workspaces.configFile(b.id))).hasCookie, false);
  (await saveSettings({ ...settings, baseBranch: "" }, workspaces.configFile(a.id)));
  assert.equal(
    (await readOptional(workspaces.configFile(a.id))).tapd.session.cookie_header,
    "dsc-token=secret-a; auth=private",
  );
  (await workspaces.save({ name: "重命名 A" }, a.id));
  assert.equal((await readSettings(workspaces.configFile(a.id))).baseBranch, "");
  (await assert.rejects(async () => (await workspaces.save({ name: "项目 B" })), /已存在/));
  (await assert.rejects(async () => (await workspaces.get("../outside")), /无效/));
  (await assert.rejects(async () => (await workspaces.get(randomUUID())), /不存在/));
  (await assert.rejects(async () => (await workspaces.save({ name: "x", repository: "x" })), /名称/));
  const restarted = new WorkspaceManager({ directory: workspaces.directory });
  assert.deepEqual((await restarted.list()), (await workspaces.list()));
  assert.equal(
    runsPath(
      (await readOptional(workspaces.configFile(a.id))),
      workspaces.configFile(a.id),
    ),
    path.join(directory, "workspaces", a.id, "runs"),
  );
  assert.equal(fs.existsSync(path.join(directory, "runner.local.json")), false);
});

test("workspace directories compose system base paths and validate before changing configuration", async (t) => {
  const { workspaces, a, b, settings, directory } = (await fixtures(t));
  t.after(() => workspaces.close());
  const file = workspaces.configFile(a.id);
  const initial = (await readSettings(file));
  assert.equal(initial.projectName, `w-${a.id.slice(0, 8)}`);
  assert.equal(initial.worktreeRoot, path.join(directory, "trees", "worktree", `w-${a.id.slice(0, 8)}`));
  assert.equal((await readSettings(workspaces.configFile(b.id))).projectName, `w-${b.id.slice(0, 8)}`);
  const saved = (await saveSettings(settings, file));
  assert.equal(saved.projectName, initial.projectName);
  assert.equal(saved.worktreeRoot, initial.worktreeRoot);
  assert.equal((await readOptional(file)).execution.projectName, initial.projectName);
  assert.equal((await readOptional(file)).execution.worktreeRoot, undefined);
  const before = fs.readFileSync(file, "utf8");
  for (const projectName of ["", "..", "../outside", "a/../b", "/outside", "C:\\outside", "C:outside", "a/NUL", "a//b", "a "])
    (await assert.rejects(async () => (await saveSettings({ ...settings, projectName }, file)), /仅允许/));
  (await assert.rejects(async () => (await saveSettings({ ...settings, repository: initial.repository }, file)), /仅允许/));
  (await assert.rejects(async () => (await saveSettings({ ...settings, worktreeRoot: path.join(directory, "old-root") }, file)), /仅允许/));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const changedBase = path.join(directory, "new-base");
  (await saveSystemSettings({ memberStorageRoot: changedBase }, directory));
  assert.equal((await readSettings(file)).worktreeRoot, path.join(changedBase, "worktree", initial.projectName));
  assert.equal((await readSettings(workspaces.configFile(b.id))).worktreeRoot, path.join(changedBase, "worktree", `w-${b.id.slice(0, 8)}`));
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("workspace settings and full execution paths reject symlink escapes without creating outside worktrees", async (t) => {
  const { workspaces, a, settings, directory, repository } = (await fixtures(t));
  t.after(() => workspaces.close());
  const file = workspaces.configFile(a.id);
  const base = path.join(directory, "trees");
  const outside = path.join(directory, "outside");
  fs.mkdirSync(base);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(base, "worktree"), process.platform === "win32" ? "junction" : "dir");
  const before = fs.readFileSync(file, "utf8");
  (await assert.rejects(async () => (await saveSettings(settings, file)), /符号链接/));
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  fs.unlinkSync(path.join(base, "worktree"));

  const saved = (await saveSettings(settings, file));
  const context = (await workspaces.get(a.id));
  const input = { channel: "manual", requestId: randomUUID(), title: "拒绝越界", content: "模拟需求" };
  const item = { id: input.requestId, workspace_id: "local" };
  const plan = worktreePlan(repository, item, "main", {
    root: saved.worktreeRoot,
    source: sourceFor("manual", item),
    workspaceId: a.id,
    name: "escape-task",
  });
  fs.symlinkSync(outside, plan.path, process.platform === "win32" ? "junction" : "dir");
  const { key } = await context.sessions.start({ ...input, worktreeName: "escape-task" });
  await context.sessions.sessions.get(key).operation;
  assert.equal((await context.sessions.store.read(key)).execution.status, "failed");
  assert.match((await context.sessions.store.read(key)).execution.error, /符号链接/);
  assert.equal(context.sessions.client.calls.some((call) => call.method === "thread/start"), false);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("new tasks use changed system bases while recorded sessions retain their original paths", async (t) => {
  const { workspaces, a, settings, directory } = (await fixtures(t));
  t.after(() => workspaces.close());
  const context = (await workspaces.get(a.id));
  const configured = (await saveSettings(settings, context.configFile));
  const manager = context.sessions;
  const start = async () => {
    const { key } = await manager.start({ channel: "manual", requestId: randomUUID(), title: "路径保存", content: "模拟需求" });
    for (let attempt = 0; !manager.sessions.get(key).turnId && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(manager.sessions.get(key).turnId, manager.sessions.get(key).error);
    await manager.interrupt(key);
    await manager.sessions.get(key).operation;
    return { key, state: (await manager.store.read(key)) };
  };
  const original = await start();
  assert.ok(original.state.worktree.path.startsWith(configured.worktreeRoot + path.sep));
  const changedBase = path.join(directory, "another-base");
  (await saveSystemSettings({ memberStorageRoot: changedBase }, directory));
  const created = await start();
  assert.ok(created.state.worktree.path.startsWith(path.join(changedBase, "worktree", configured.projectName) + path.sep));
  assert.notEqual(created.state.worktree.path, original.state.worktree.path);
  manager.client.close();
  await manager.events.drain();
  await manager.send(original.key, "继续原来的任务");
  const resumed = manager.client.calls.filter((call) => call.method === "thread/resume").at(-1).params;
  assert.equal(resumed.cwd, original.state.worktree.path);
  assert.equal(resumed.threadId, original.state.session_id);
  assert.equal((await manager.store.read(original.key)).worktree.path, original.state.worktree.path);
  await manager.interrupt(original.key);
});

test("Cookie maintenance preserves secrets, checks drafts without saving, and sanitizes failures", async (t) => {
  const { workspaces, a } = (await fixtures(t));
  const file = workspaces.configFile(a.id);
  const draft = {
    workspaceId: "42",
    cookie: "dsc-token=secret-a; auth=private",
  };
  (await saveTapdSettings(file, draft));
  const saved = fs.readFileSync(file, "utf8");
  assert.equal(
    JSON.stringify((await readTapdSettings(file))).includes("secret-a"),
    false,
  );
  const calls = [];
  const result = await checkTapdSettings(
    file,
    { workspaceId: "99", cookie: "dsc-token=draft-only" },
    async (session, endpoint, options) => {
      calls.push({ session, endpoint, options });
      return { workitem_list: [] };
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0].session.cookie_header, "dsc-token=draft-only");
  assert.equal(JSON.parse(calls[0].options.body).group_id, "99");
  assert.equal(JSON.parse(calls[0].options.body).perpage, "1");
  assert.equal(fs.readFileSync(file, "utf8"), saved);
  for (const response of [
    Response.json({ meta: { code: 1 }, data: {} }),
    new Response("<html>Login</html>"),
    json({ unexpected: true }),
  ]) {
    t.mock.method(global, "fetch", async () => response);
    await assert.rejects(
      checkTapdSettings(file, { workspaceId: "42" }),
      /检测失败/,
    );
    t.mock.restoreAll();
  }
  t.mock.method(global, "fetch", async () => json({ workitem_list: [] }));
  assert.equal(
    (await checkTapdSettings(file, { workspaceId: "42", cookie: "" })).ok,
    true,
  );
  (await saveTapdSettings(file, { workspaceId: "42", cookie: "" }));
  assert.equal((await readOptional(file)).tapd.session.cookie_header, draft.cookie);
  (await assert.rejects(
    async () => (await saveTapdSettings(file, { ...draft, cookie: "bad\nheader" })),
    /格式/,
  ));
  (await assert.rejects(
    async () => (await saveTapdSettings(file, { ...draft, cookie: "no-token=1" })),
    /dsc-token/,
  ));
  (await assert.rejects(
    async () =>
      (await saveTapdSettings(file, { ...draft, imageHosts: ["https://example.com"] })),
    /域名/,
  ));
  (await saveTapdSettings(file, { workspaceId: "42", clearCookie: true }));
  assert.equal((await readTapdSettings(file)).hasCookie, false);
  await assert.rejects(checkTapdSettings(file, { workspaceId: "42" }), /填写/);
});

test("same requirement runs independently in two workspaces with isolated uploads, branches and model", async (t) => {
  const { workspaces, a, b, settings, git } = (await fixtures(t));
  t.after(() => workspaces.close());
  const first = (await workspaces.get(a.id)),
    second = (await workspaces.get(b.id));
  (await saveSettings(settings, first.configFile));
  (await saveSettings(settings, second.configFile));
  const upload = (await first.channels.get("manual").uploadImage(png));
  const input = {
    channel: "manual",
    requestId: randomUUID(),
    title: "相同需求",
    content: "实现要求",
    images: [upload.id],
    worktreeName: "same-name",
  };
  await assert.rejects(second.channels.get("manual").resolve(input), /不存在/);
  const startedA = await first.sessions.start({
    ...input,
    model: "fixture-model-a",
    reasoningEffort: "high",
  });
  const firstDeadline = Date.now() + 20000;
  while (!first.sessions.sessions.get(startedA.key)?.turnId && Date.now() < firstDeadline)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(first.sessions.sessions.get(startedA.key)?.turnId, JSON.stringify(await first.sessions.store.read(startedA.key)));
  const startedB = await second.sessions.start({
    ...input,
    images: [],
    model: "fixture-model-b",
    reasoningEffort: "low",
  });
  assert.equal(startedA.key, startedB.key);
  const key = startedA.key;
  // Fake Codex confirms startup synchronously after filesystem preparation.
  for (const context of [first, second]) {
    for (
      let attempt = 0;
      !context.sessions.sessions.get(key)?.turnId && attempt < 2000;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(context.sessions.sessions.get(key)?.turnId, JSON.stringify(await context.sessions.store.read(key)));
  }
  const stateA = (await first.sessions.store.read(key)),
    stateB = (await second.sessions.store.read(key));
  assert.equal(stateA.workspace_id, a.id);
  assert.equal(stateB.workspace_id, b.id);
  assert.notEqual(stateA.worktree.path, stateB.worktree.path);
  assert.notEqual(stateA.worktree.branch, stateB.worktree.branch);
  assert.ok(fs.existsSync(stateA.worktree.path));
  assert.ok(fs.existsSync(stateB.worktree.path));
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(
    first.sessions.client.calls.find((entry) => entry.method === "thread/start")
      .params.model,
    "fixture-model-a",
  );
  assert.equal(
    second.sessions.client.calls.find(
      (entry) => entry.method === "thread/start",
    ).params.model,
    "fixture-model-b",
  );
  assert.equal(
    first.sessions.client.calls.find((entry) => entry.method === "turn/start")
      .params.effort,
    "high",
  );
  assert.equal(
    second.sessions.client.calls.find((entry) => entry.method === "turn/start")
      .params.effort,
    "low",
  );
  assert.equal(stateA.agent.reasoningEffort, "high");
  const view = await first.sessions.view(key);
  assert.equal(
    view.requirement.images[0].url,
    `/api/workspaces/${a.id}/runs/${key}/images/0`,
  );
  await first.sessions.interrupt(key);
  assert.ok(second.sessions.sessions.get(key).turnId);
  await first.sessions.sessions.get(key).operation;
  (await saveSettings({ ...settings, baseBranch: "" }, first.configFile));
  await first.sessions.send(key, "继续原任务");
  assert.equal(
    first.sessions.client.calls
      .filter((entry) => entry.method === "turn/start")
      .at(-1).params.effort,
    "high",
  );
  assert.equal(
    first.sessions.client.calls
      .filter((entry) => entry.method === "turn/start")
      .at(-1).params.model,
    "fixture-model-a",
  );
  await first.sessions.interrupt(key);
  first.sessions.client.close();
  await first.sessions.events.drain();
  await first.sessions.send(key, "重新连接后继续");
  assert.equal(
    first.sessions.client.calls
      .filter((entry) => entry.method === "thread/resume")
      .at(-1).params.model,
    "fixture-model-a",
  );
  assert.equal(
    first.sessions.client.calls
      .filter((entry) => entry.method === "turn/start")
      .at(-1).params.effort,
    "high",
  );
  await first.sessions.interrupt(key);
  await second.sessions.interrupt(key);
  await Promise.all([
    first.sessions.sessions.get(key).operation,
    second.sessions.sessions.get(key).operation,
  ]);
});

test("HTTP requires explicit workspace context and isolates lists, images, SSE and bound TAPD projects", async (t) => {
  const { workspaces, a, b } = (await fixtures(t));
  const app = createWebServer({ testIdentity: true, workspaces, workspaceClones: fixtureWorkspaceClones(workspaces) });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.equal(boot.workspaces.length, 2);
  assert.equal((await fetch(`${origin}/api/runs`)).status, 404);
  const headers = {
    "content-type": "application/json",
    "x-tapd-token": boot.token,
  };
  const post = (url, data, extra = {}) =>
    fetch(`${origin}${url}`, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(data),
    });
  assert.equal(
    (
      await post(
        "/api/workspaces",
        { name: "blocked" },
        { "x-tapd-token": "bad" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/api/workspaces",
        { name: "blocked" },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  assert.equal((await post("/api/workspaces", { name: "项目 C" })).status, 202);
  const prefix = (id) => `/api/workspaces/${id}`;
  const first = (await workspaces.get(a.id)),
    second = (await workspaces.get(b.id));
  fs.mkdirSync(first.sessions.store.dir("1-2"), { recursive: true });
  fs.writeFileSync(
    path.join(first.sessions.store.dir("1-2"), "run.json"),
    JSON.stringify({
      workitem: { title: "A 的任务", id: "2", workspace_id: "1" },
      agent: { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask" },
      execution: { status: "completed" },
    }),
  );
  assert.equal(
    (await (await fetch(`${origin}${prefix(a.id)}/runs`)).json()).runs.length,
    1,
  );
  assert.equal(
    (await (await fetch(`${origin}${prefix(b.id)}/runs`)).json()).runs.length,
    0,
  );
  assert.equal((await fetch(`${origin}${prefix(b.id)}/runs/1-2`)).status, 404);
  const saved = await post(`${prefix(a.id)}/settings/tapd`, {
    workspaceId: "42",
    cookie: "dsc-token=private",
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.text()).includes("private"), false);
  assert.equal(
    (await fetch(`${origin}${prefix(a.id)}/requirements?workspace=43`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${origin}${prefix(a.id)}/users?workspace=43`)).status,
    400,
  );
  const bootstrap = await (
    await fetch(`${origin}${prefix(a.id)}/bootstrap`)
  ).json();
  assert.equal(bootstrap.workspace, "42");
  assert.equal(bootstrap.channels[0].scopeLocked, true);
  assert.equal(
    (await (await fetch(`${origin}${prefix(b.id)}/settings/tapd`)).json())
      .hasCookie,
    false,
  );
  const abort = new AbortController();
  const events = await fetch(`${origin}${prefix(a.id)}/events`, {
    signal: abort.signal,
  });
  const reader = events.body.getReader();
  await reader.read();
  second.sessions.emit("event", { key: "1-2", marker: "wrong-workspace" });
  first.sessions.emit("event", { key: "1-2", marker: "correct-workspace" });
  const chunk = Buffer.from((await reader.read()).value).toString();
  assert.match(chunk, /correct-workspace/);
  assert.doesNotMatch(chunk, /wrong-workspace/);
  abort.abort();
});

test("tasks in one workspace select independent models and resume their snapshots", async (t) => {
  const { workspaces, a, settings } = (await fixtures(t));
  t.after(() => workspaces.close());
  const context = (await workspaces.get(a.id)),
    manager = context.sessions;
  (await saveSettings(settings, context.configFile));
  const config = (await readOptional(context.configFile));
  config.agent.model = "obsolete-workspace-model";
  config.agent.reasoningEffort = "high";
  (await writeConfig(context.configFile, config));
  const input = {
    channel: "manual",
    title: "模型隔离",
    content: "模拟需求",
    metadata: { type: "bug" },
  };
  for (const selection of [
    { model: "missing" },
    { model: "fixture-model-b", reasoningEffort: "high" },
  ]) {
    await assert.rejects(
      manager.start({ ...input, requestId: randomUUID(), ...selection }),
      /可用列表|不支持/,
    );
  }
  assert.equal(manager.store.owned.size, 0);
  assert.equal(
    manager.client.calls.some((call) => call.method === "thread/start"),
    false,
  );
  const keys = [];
  for (const selection of [
    { model: "fixture-model-a", reasoningEffort: "high", permissionMode: "full" },
    { model: "fixture-model-b", reasoningEffort: "medium", permissionMode: "auto" },
    {},
  ]) {
    const { key } = await manager.start({
      ...input,
      requestId: randomUUID(),
      ...selection,
    });
    keys.push(key);
    for (
      let attempt = 0;
      !manager.sessions.get(key)?.turnId && attempt < 2000;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(manager.sessions.get(key).turnId);
    assert.deepEqual((await manager.store.readTaskMetadata(key)), {
      type: "bug",
      progress: "in_progress",
    });
    assert.deepEqual((await manager.store.read(key)).agent, {
      provider: "codex",
      model: selection.model || "",
      reasoningEffort: selection.reasoningEffort || "",
      permissionMode: selection.permissionMode || "ask",
    });
    const presentedAgent = (await manager.view(key)).agent;
    assert.equal(presentedAgent.provider, "codex");
    assert.equal(presentedAgent.model, selection.model || "");
    assert.equal(presentedAgent.reasoningEffort, selection.reasoningEffort || "");
    assert.deepEqual((await manager.view(key)).executionSettings, {
      model: selection.model || "", reasoningEffort: selection.reasoningEffort || "",
      permissionMode: selection.permissionMode || "ask",
    });
  }
  assert.deepEqual(
    manager.client.calls
      .filter((call) => call.method === "thread/start")
      .map((call) => call.params.model),
    ["fixture-model-a", "fixture-model-b", "fixture-model-a"],
  );
  assert.deepEqual(
    manager.client.calls
      .filter((call) => call.method === "turn/start")
      .map((call) => call.params.effort),
    ["high", "medium", "low"],
  );
  assert.deepEqual(manager.client.calls.filter((call) => call.method === "turn/start")
    .map((call) => [call.params.approvalPolicy, call.params.approvalsReviewer, call.params.sandboxPolicy.type]),
  [["never", "user", "dangerFullAccess"], ["on-request", "auto_review", "workspaceWrite"], ["on-request", "user", "workspaceWrite"]]);
  await manager.updateTaskMetadata(keys[0], { progress: "merge" });
  for (const key of keys) {
    await manager.interrupt(key);
    await manager.sessions.get(key).operation;
  }
  manager.client.close();
  for (const [index, key] of keys.entries()) {
    await manager.send(key, "继续此需求");
    const call = manager.client.calls
      .filter((call) => call.method === "turn/start")
      .at(-1);
    assert.equal(
      call.params.model,
      ["fixture-model-a", "fixture-model-b", "fixture-model-a"][index],
    );
    assert.equal(call.params.effort, ["high", "medium", "low"][index]);
    await manager.interrupt(key);
    assert.equal(
      (await manager.store.readTaskMetadata(key)).progress,
      index === 0 ? "merge" : "in_progress",
    );
  }
  (await saveSettings(settings, context.configFile));
  assert.equal((await readOptional(context.configFile)).agent.model, "obsolete-workspace-model");
  assert.equal(
    (await readOptional(context.configFile)).agent.reasoningEffort,
    "high",
  );
});

test("workspace icon IDs persist independently, validate before saving and preserve project settings", async (t) => {
  const { workspaces, a, b, settings } = (await fixtures(t));
  t.after(() => workspaces.close());
  const file = workspaces.configFile(a.id);
  (await saveSettings(settings, file));
  (await saveTapdSettings(file, { workspaceId: "42", cookie: "dsc-token=private" }));
  const before = (await readOptional(file));
  const context = (await workspaces.get(a.id));
  (await workspaces.save({ name: a.name, icon: "rocket" }, a.id));
  assert.equal((await workspaces.read(a.id)).icon, "rocket");
  assert.equal((await workspaces.get(a.id)), context);
  assert.equal((await workspaces.read(b.id)).icon, null);
  const saved = (await readOptional(file));
  assert.deepEqual(saved.execution, before.execution);
  assert.deepEqual(saved.agent, before.agent);
  assert.deepEqual(saved.tapd, before.tapd);
  const restarted = new WorkspaceManager({ directory: workspaces.directory });
  assert.equal((await restarted.read(a.id)).icon, "rocket");
  (await workspaces.save({ name: "新名称" }, a.id));
  assert.equal((await workspaces.read(a.id)).icon, "rocket");
  const raw = fs.readFileSync(file, "utf8");
  for (const icon of [
    "missing",
    "<svg onload=alert(1)>",
    "https://example.com/icon.svg",
    "__proto__",
    "constructor",
    {},
    7,
    false,
    "",
  ]) {
    (await assert.rejects(
      async () => (await workspaces.save({ name: "新名称", icon }, a.id)),
      /图标库/,
    ));
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  }
  (await workspaces.save({ name: "新名称", icon: null }, a.id));
  assert.equal((await restarted.read(a.id)).icon, null);
  const app = createWebServer({ testIdentity: true, workspaces, workspaceClones: fixtureWorkspaceClones(workspaces) });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  const res = await fetch(`${origin}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tapd-token": boot.token },
    body: JSON.stringify({ name: "带图标的工作区", icon: "code" }),
  });
  assert.equal(res.status, 202);
  const created = (await res.json()).clone.workspace;
  assert.equal(created.icon, "code");
  const reload = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.equal(
    reload.workspaces.find((entry) => entry.id === created.id).icon,
    "code",
  );
});
