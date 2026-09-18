const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { temporary, png } = require("../support/helpers.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { Workspaces } = require("../../src/application/workspaces.cjs");
const { WebSessions } = require("../../src/application/sessions.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { saveSettings } = require("../../src/config/execution-settings.cjs");
const {
  readPromptSettings,
  savePromptSettings,
} = require("../../src/config/prompt-settings.cjs");
const { saveTapdSettings } = require("../../src/channels/tapd/settings.cjs");
const { readOptional } = require("../../src/storage/json-files.cjs");

const manualTemplate = "自定义手动模板\n{{title}}\n{{content}}\n{{images}}";
const tapdTemplate = "自定义 TAPD 模板\n{{title}}\n{{content}}\n{{supplement}}\n{{images}}";

function workspaceCatalog(directory) {
  return new Workspaces({
    directory,
    createManager: (options) =>
      new WebSessions({ ...options, client: new FakeClient() }),
  });
}

function fixture(t) {
  const directory = temporary(t);
  const workspaces = workspaceCatalog(path.join(directory, "workspaces"));
  const a = workspaces.save({ name: "模板项目 A" });
  const b = workspaces.save({ name: "模板项目 B" });
  return { directory, workspaces, a, b };
}

async function httpFixture(t, workspaces) {
  const app = createWebServer({ workspaces });
  const origin = await app.listen(0);
  t.after(() => app.close());
  const boot = await (await fetch(`${origin}/api/bootstrap`)).json();
  const route = (id) => `/api/workspaces/${id}/settings/prompts`;
  const get = (id) => fetch(`${origin}${route(id)}`);
  const post = (id, input, extraHeaders = {}) =>
    fetch(`${origin}${route(id)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tapd-token": boot.token,
        ...extraHeaders,
      },
      body: JSON.stringify(input),
    });
  return { app, origin, get, post, token: boot.token };
}

function configureRepository(directory, configFile) {
  const repository = path.join(directory, "repository");
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
    "-c", "user.name=Fixture",
    "-c", "user.email=test@example.invalid",
    "-c", "core.hooksPath=/dev/null",
    "commit", "-m", "fixture",
  );
  const settings = {
    repository,
    worktreeRoot: path.join(directory, "trees"),
    baseRef: "main",
    initCommands: [],
  };
  saveSettings(settings, configFile);
  return settings;
}

async function awaitTurn(manager, key) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const runtime = manager.sessions.get(key);
    if (runtime?.turnId) return runtime;
    if (runtime?.status === "failed") assert.fail(runtime.error);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Fake Codex did not receive a turn.");
}

test("workspace prompt settings guard writes, isolate credentials and persist templates atomically", async (t) => {
  const { workspaces, a, b } = fixture(t);
  const file = workspaces.configFile(a.id);
  saveTapdSettings(file, {
    workspaceId: "42",
    cookie: "dsc-token=private-template-secret; auth=private-session",
  });
  saveTapdSettings(workspaces.configFile(b.id), {
    workspaceId: "84",
    cookie: "dsc-token=other-workspace-secret; auth=other-session",
  });
  const originalConfig = readOptional(file);
  const otherConfig = fs.readFileSync(workspaces.configFile(b.id), "utf8");
  const before = fs.readFileSync(file, "utf8");
  const { app, origin, get, post, token } = await httpFixture(t, workspaces);
  const defaults = await (await get(a.id)).json();
  assert.deepEqual(Object.keys(defaults).sort(), ["catalog", "maxLength", "templates"]);
  assert.deepEqual(Object.keys(defaults.templates).sort(), ["manual", "tapd"]);
  assert.equal(defaults.maxLength, 20000);
  assert.doesNotMatch(JSON.stringify(defaults), /private-template-secret|private-session|cookie_header|dsc_token/);
  assert.deepEqual((await (await get(b.id)).json()).templates, defaults.templates);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal((await fetch(`${origin}/api/settings/prompts`)).status, 400);
  assert.equal((await fetch(`${origin}/api/settings/prompts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tapd-token": token },
    body: JSON.stringify({ manual: manualTemplate }),
  })).status, 400);
  assert.equal((await get(randomUUID())).status, 404);
  assert.equal((await get("invalid-workspace")).status, 400);
  assert.equal((await fetch(`${origin}/api/workspaces/${a.id}/settings/prompts`, {
    headers: { origin: "https://other.invalid" },
  })).status, 403);

  for (const headers of [
    { "x-tapd-token": "invalid" },
    { origin: "https://other.invalid" },
  ]) {
    assert.equal((await post(a.id, { manual: manualTemplate }, headers)).status, 403);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  }
  const saved = await post(a.id, { manual: manualTemplate, tapd: tapdTemplate });
  assert.equal(saved.status, 200);
  const response = await saved.json();
  assert.deepEqual(response.templates, { manual: manualTemplate, tapd: tapdTemplate });
  assert.doesNotMatch(JSON.stringify(response), /private-template-secret|private-session|cookie_header|dsc_token/);
  assert.deepEqual((await (await get(a.id)).json()).templates, response.templates);
  assert.deepEqual((await (await get(b.id)).json()).templates, defaults.templates);
  const changedConfig = readOptional(file);
  for (const field of ["workspace", "codex", "tapd", "workflow"])
    assert.deepEqual(changedConfig[field], originalConfig[field]);
  assert.deepEqual(changedConfig.prompt_templates, response.templates);
  assert.equal(fs.readFileSync(workspaces.configFile(b.id), "utf8"), otherConfig);

  const persisted = fs.readFileSync(file, "utf8");
  for (const input of [
    { unknown: manualTemplate },
    { manual: manualTemplate, tapd: "{{title}}\n{{content}}\n{{images}}" },
    { manual: `${manualTemplate}\n{{cookie}}` },
    { manual: `${manualTemplate}\n{{unknown}}` },
    { manual: "{{title}}\n{{images}}" },
    { manual: 7 },
    { tapd: [] },
    { manual: "" },
    { manual: `${manualTemplate}${"x".repeat(20000)}` },
  ]) {
    assert.equal((await post(a.id, input)).status, 400, JSON.stringify(input).slice(0, 160));
    assert.equal(fs.readFileSync(file, "utf8"), persisted);
  }

  await app.close();
  const reloaded = workspaceCatalog(workspaces.directory);
  const restarted = await httpFixture(t, reloaded);
  assert.deepEqual((await (await restarted.get(a.id)).json()).templates, response.templates);
  assert.deepEqual((await (await restarted.get(b.id)).json()).templates, defaults.templates);
  const resetManual = await restarted.post(a.id, { manual: null });
  assert.equal(resetManual.status, 200);
  assert.deepEqual((await resetManual.json()).templates, {
    manual: defaults.templates.manual,
    tapd: tapdTemplate,
  });
  assert.equal((await restarted.post(a.id, { tapd: null })).status, 200);
  assert.deepEqual(readPromptSettings(file), defaults.templates);
  assert.deepEqual(readOptional(file).tapd, originalConfig.tapd);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.readFileSync(workspaces.configFile(b.id), "utf8"), otherConfig);
});

test("new fake sessions use saved prompts while existing snapshots and continuation keep their identity", async (t) => {
  const { directory, workspaces, a, b } = fixture(t);
  const context = workspaces.get(a.id);
  const second = workspaces.get(b.id);
  const settings = configureRepository(directory, context.configFile);
  saveSettings(settings, second.configFile);
  const { get, post } = await httpFixture(t, workspaces);
  const secondTemplate = manualTemplate.replace("自定义手动模板", "项目 B 独立模板");
  assert.equal((await post(a.id, { manual: manualTemplate })).status, 200);
  assert.equal((await post(b.id, { manual: secondTemplate })).status, 200);
  const upload = context.channels.get("manual").uploadImage(png);
  const input = {
    channel: "manual",
    requestId: randomUUID(),
    title: "占位符需求标题",
    content: "需求内容中的 {{title}} 应原样保留。",
    images: [upload.id],
  };
  const manager = context.sessions;
  const { key } = await manager.start(input);
  await awaitTurn(manager, key);
  const state = manager.store.read(key);
  const task = manager.store.readTask(key);
  const initialPrompt = task.codex_prompt;
  assert.ok(initialPrompt.startsWith("自定义手动模板\n占位符需求标题\n"));
  assert.ok(initialPrompt.includes(input.content));
  assert.ok(initialPrompt.includes(task.images[0].path));
  const firstTurn = manager.client.calls.find((call) => call.method === "turn/start");
  assert.equal(firstTurn.params.input[0].text, initialPrompt);
  assert.deepEqual(firstTurn.params.input[1], { type: "localImage", path: task.images[0].path });
  const snapshotFile = path.join(manager.store.dir(key), "requirement.json");
  const snapshot = fs.readFileSync(snapshotFile, "utf8");

  const changedTemplate = manualTemplate.replace("自定义手动模板", "新保存的模板");
  assert.equal((await post(a.id, { manual: changedTemplate })).status, 200);
  assert.equal((await (await get(a.id)).json()).templates.manual, changedTemplate);
  assert.equal((await (await get(b.id)).json()).templates.manual, secondTemplate);
  assert.equal((await manager.view(key)).requirement.prompt, initialPrompt);
  assert.equal(fs.readFileSync(snapshotFile, "utf8"), snapshot);
  await manager.interrupt(key);
  await manager.sessions.get(key).operation;
  manager.client.close();
  await manager.send(key, "按原需求继续开发");
  const continued = manager.client.calls.filter((call) => call.method === "turn/start").at(-1);
  assert.equal(continued.params.threadId, state.session_id);
  assert.deepEqual(continued.params.input, [
    { type: "text", text: "按原需求继续开发", text_elements: [] },
  ]);
  assert.equal(manager.store.read(key).worktree.path, state.worktree.path);
  assert.equal(manager.client.calls.filter((call) => call.method === "thread/start").length, 1);
  assert.equal(fs.readFileSync(snapshotFile, "utf8"), snapshot);
  await manager.interrupt(key);

  for (const [sessions, workspaceId, prefix] of [
    [manager, a.id, "新保存的模板\n"],
    [second.sessions, b.id, "项目 B 独立模板\n"],
  ]) {
    const next = await sessions.start({ ...input, requestId: randomUUID(), images: [] });
    await awaitTurn(sessions, next.key);
    const nextTask = sessions.store.readTask(next.key);
    assert.ok(nextTask.codex_prompt.startsWith(prefix));
    assert.equal(sessions.client.calls.filter((call) => call.method === "turn/start").at(-1).params.input[0].text, nextTask.codex_prompt);
    assert.equal(sessions.store.read(next.key).workspace_id, workspaceId);
    assert.notEqual(sessions.store.read(next.key).worktree.path, state.worktree.path);
    assert.equal((await manager.view(key)).requirement.prompt, initialPrompt);
    await sessions.interrupt(next.key);
    await sessions.sessions.get(next.key).operation;
  }
  assert.equal(fs.readFileSync(snapshotFile, "utf8"), snapshot);
});

test("manual preparation uses the template captured when the requirement was resolved", async (t) => {
  const { directory, workspaces, a } = fixture(t);
  t.after(() => workspaces.close());
  const context = workspaces.get(a.id);
  savePromptSettings(context.configFile, { manual: manualTemplate });
  const channel = context.channels.get("manual");
  const resolved = await channel.resolve({
    requestId: randomUUID(),
    title: "已解析需求",
    content: "准备之前保存了另一份模板。",
  });
  savePromptSettings(context.configFile, {
    manual: manualTemplate.replace("自定义手动模板", "准备期间更改的模板"),
  });
  const prepared = await channel.prepare({ ...resolved, directory: path.join(directory, "prepared") });
  assert.ok(prepared.task.codex_prompt.startsWith("自定义手动模板\n已解析需求\n"));
  assert.ok(readPromptSettings(context.configFile).manual.startsWith("准备期间更改的模板\n"));
});
