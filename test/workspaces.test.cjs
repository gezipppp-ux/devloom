const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { temporary, png, json } = require("./helpers.cjs");
const { FakeClient } = require("./fixtures/web_client.cjs");
const { Workspaces } = require("../src/workspaces.cjs");
const { WebSessions } = require("../src/web_sessions.cjs");
const { createWebServer } = require("../src/web_server.cjs");
const {
  writeConfig,
  readOptional,
  readSettings,
  saveSettings,
} = require("../src/settings.cjs");
const { runsPath } = require("../src/config.cjs");
const {
  saveTapdSettings,
  readTapdSettings,
  checkTapdSettings,
} = require("../src/channels/tapd_settings.cjs");

function fixtures(t) {
  const directory = temporary(t);
  const workspaces = new Workspaces({
    directory: path.join(directory, "workspaces"),
    createManager: (options) =>
      new WebSessions({ ...options, client: new FakeClient() }),
  });
  const a = workspaces.save({ name: "项目 A" }),
    b = workspaces.save({ name: "项目 B" });
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
  const settings = {
    repository,
    worktreeRoot: path.join(directory, "trees"),
    baseRef: "main",
    initCommands: [],
  };
  return { directory, workspaces, a, b, settings, git };
}

test("workspaces isolate settings, credentials and restart state; names never become paths", async (t) => {
  const { workspaces, a, b, settings, directory } = fixtures(t);
  t.after(() => workspaces.close());
  saveSettings(settings, workspaces.configFile(a.id));
  saveTapdSettings(workspaces.configFile(a.id), {
    workspaceId: "42",
    cookie: "dsc-token=secret-a; auth=private",
    targetStatus: "developing",
  });
  assert.equal(readSettings(workspaces.configFile(a.id)).model, undefined);
  assert.throws(
    () =>
      saveSettings({ ...settings, model: "a" }, workspaces.configFile(a.id)),
    /仅允许/,
  );
  assert.throws(
    () =>
      saveSettings(
        { ...settings, reasoningEffort: "high" },
        workspaces.configFile(a.id),
      ),
    /仅允许/,
  );
  assert.equal(readSettings(workspaces.configFile(b.id)).repository, "");
  assert.equal(readTapdSettings(workspaces.configFile(b.id)).hasCookie, false);
  saveSettings({ ...settings, baseRef: "HEAD" }, workspaces.configFile(a.id));
  assert.equal(
    readOptional(workspaces.configFile(a.id)).tapd.session.cookie_header,
    "dsc-token=secret-a; auth=private",
  );
  workspaces.save({ name: "重命名 A" }, a.id);
  assert.equal(readSettings(workspaces.configFile(a.id)).baseRef, "HEAD");
  assert.throws(() => workspaces.save({ name: "项目 B" }), /已存在/);
  assert.throws(() => workspaces.get("../outside"), /无效/);
  assert.throws(() => workspaces.get(randomUUID()), /不存在/);
  assert.throws(() => workspaces.save({ name: "x", repository: "x" }), /名称/);
  const restarted = new Workspaces({ directory: workspaces.directory });
  assert.deepEqual(restarted.list(), workspaces.list());
  assert.equal(
    runsPath(
      readOptional(workspaces.configFile(a.id)),
      workspaces.configFile(a.id),
    ),
    path.join(directory, "workspaces", a.id, "runs"),
  );
  assert.equal(fs.existsSync(path.join(directory, "runner.local.json")), false);
});

test("Cookie maintenance preserves secrets, checks drafts without saving, and sanitizes failures", async (t) => {
  const { workspaces, a } = fixtures(t);
  const file = workspaces.configFile(a.id);
  const draft = {
    workspaceId: "42",
    cookie: "dsc-token=secret-a; auth=private",
  };
  saveTapdSettings(file, draft);
  const saved = fs.readFileSync(file, "utf8");
  assert.equal(
    JSON.stringify(readTapdSettings(file)).includes("secret-a"),
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
  saveTapdSettings(file, { workspaceId: "42", cookie: "" });
  assert.equal(readOptional(file).tapd.session.cookie_header, draft.cookie);
  assert.throws(
    () => saveTapdSettings(file, { ...draft, cookie: "bad\nheader" }),
    /格式/,
  );
  assert.throws(
    () => saveTapdSettings(file, { ...draft, cookie: "no-token=1" }),
    /dsc-token/,
  );
  assert.throws(
    () =>
      saveTapdSettings(file, { ...draft, imageHosts: ["https://example.com"] }),
    /域名/,
  );
  saveTapdSettings(file, { workspaceId: "42", clearCookie: true });
  assert.equal(readTapdSettings(file).hasCookie, false);
  await assert.rejects(checkTapdSettings(file, { workspaceId: "42" }), /填写/);
});

test("same requirement runs independently in two workspaces with isolated uploads, branches and model", async (t) => {
  const { workspaces, a, b, settings, git } = fixtures(t);
  t.after(() => workspaces.close());
  const first = workspaces.get(a.id),
    second = workspaces.get(b.id);
  saveSettings(settings, first.configFile);
  saveSettings(settings, second.configFile);
  const upload = first.channels.get("manual").uploadImage(png);
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
      !context.sessions.sessions.get(key)?.turnId && attempt < 100;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(context.sessions.sessions.get(key).turnId);
  }
  const stateA = first.sessions.store.read(key),
    stateB = second.sessions.store.read(key);
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
  assert.equal(stateA.codex.reasoning_effort, "high");
  const view = await first.sessions.view(key);
  assert.equal(
    view.requirement.images[0].url,
    `/api/workspaces/${a.id}/runs/${key}/images/0`,
  );
  await first.sessions.interrupt(key);
  assert.ok(second.sessions.sessions.get(key).turnId);
  await first.sessions.sessions.get(key).operation;
  saveSettings({ ...settings, baseRef: "HEAD" }, first.configFile);
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
  const { workspaces, a, b } = fixtures(t);
  const app = createWebServer({ workspaces });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.equal(boot.workspaces.length, 2);
  assert.equal((await fetch(`${origin}/api/runs`)).status, 400);
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
  assert.equal((await post("/api/workspaces", { name: "项目 C" })).status, 201);
  const prefix = (id) => `/api/workspaces/${id}`;
  const first = workspaces.get(a.id),
    second = workspaces.get(b.id);
  fs.mkdirSync(first.sessions.store.dir("1-2"), { recursive: true });
  fs.writeFileSync(
    path.join(first.sessions.store.dir("1-2"), "run.json"),
    JSON.stringify({
      workitem: { title: "A 的任务", id: "2", workspace_id: "1" },
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

test("tasks in one workspace select independent models, ignore old settings and resume their snapshots", async (t) => {
  const { workspaces, a, settings } = fixtures(t);
  t.after(() => workspaces.close());
  const context = workspaces.get(a.id),
    manager = context.sessions;
  saveSettings(settings, context.configFile);
  const config = readOptional(context.configFile);
  config.codex.model = "obsolete-workspace-model";
  config.codex.reasoning_effort = "high";
  writeConfig(context.configFile, config);
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
    { model: "fixture-model-a", reasoningEffort: "high" },
    { model: "fixture-model-b", reasoningEffort: "medium" },
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
      !manager.sessions.get(key)?.turnId && attempt < 100;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(manager.sessions.get(key).turnId);
    assert.deepEqual(manager.store.readTaskMetadata(key), {
      type: "bug",
      progress: "in_progress",
    });
    assert.deepEqual(manager.store.read(key).codex, {
      model: selection.model || "",
      reasoning_effort: selection.reasoningEffort || "",
    });
    assert.deepEqual((await manager.view(key)).codex, {
      model: selection.model || "",
      reasoningEffort: selection.reasoningEffort || "",
    });
  }
  assert.deepEqual(
    manager.client.calls
      .filter((call) => call.method === "thread/start")
      .map((call) => call.params.model),
    ["fixture-model-a", "fixture-model-b", undefined],
  );
  assert.deepEqual(
    manager.client.calls
      .filter((call) => call.method === "turn/start")
      .map((call) => call.params.effort),
    ["high", "medium", undefined],
  );
  manager.updateTaskMetadata(keys[0], { progress: "merge" });
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
      ["fixture-model-a", "fixture-model-b", undefined][index],
    );
    assert.equal(call.params.effort, ["high", "medium", undefined][index]);
    await manager.interrupt(key);
    assert.equal(
      manager.store.readTaskMetadata(key).progress,
      index === 0 ? "merge" : "in_progress",
    );
  }
  saveSettings(settings, context.configFile);
  assert.equal(readOptional(context.configFile).codex.model, undefined);
  assert.equal(
    readOptional(context.configFile).codex.reasoning_effort,
    undefined,
  );
});

test("workspace icon IDs persist independently, validate before saving and preserve project settings", async (t) => {
  const { workspaces, a, b, settings } = fixtures(t);
  t.after(() => workspaces.close());
  const file = workspaces.configFile(a.id);
  saveSettings(settings, file);
  saveTapdSettings(file, { workspaceId: "42", cookie: "dsc-token=private" });
  const before = readOptional(file);
  const context = workspaces.get(a.id);
  workspaces.save({ name: a.name, icon: "rocket" }, a.id);
  assert.equal(workspaces.read(a.id).icon, "rocket");
  assert.equal(workspaces.get(a.id), context);
  assert.equal(workspaces.read(b.id).icon, null);
  const saved = readOptional(file);
  assert.deepEqual(saved.codex, before.codex);
  assert.deepEqual(saved.tapd, before.tapd);
  const restarted = new Workspaces({ directory: workspaces.directory });
  assert.equal(restarted.read(a.id).icon, "rocket");
  workspaces.save({ name: "新名称" }, a.id);
  assert.equal(workspaces.read(a.id).icon, "rocket");
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
    assert.throws(
      () => workspaces.save({ name: "新名称", icon }, a.id),
      /图标库/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  }
  workspaces.save({ name: "新名称", icon: null }, a.id);
  assert.equal(restarted.read(a.id).icon, null);
  const app = createWebServer({ workspaces });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  const res = await fetch(`${origin}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tapd-token": boot.token },
    body: JSON.stringify({ name: "带图标的工作区", icon: "code" }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.icon, "code");
  const reload = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.equal(
    reload.workspaces.find((entry) => entry.id === created.id).icon,
    "code",
  );
});
