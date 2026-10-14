const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { setImmediate: immediate } = require("node:timers/promises");
const { temporary, png } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");
const { runKey } = require("../../src/domain/run-identity.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { ProjectLifecycleServices } = require("../../src/application/project-lifecycle-services.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { hashPassword } = require("../../src/storage/account-passwords.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { SystemWorkflowServices } = require("../../src/application/system-workflow-services.cjs");

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  const department = await database.client.department.create({ data: { name: "开发测试", permissions } });
  const actor = await database.client.user.create({ data: { username: "developer", displayName: "developer", passwordHash: "unused", departmentId: department.id } });
  const other = await database.client.user.create({ data: { username: "other-dev", displayName: "other-dev", passwordHash: "unused", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "开发项目", directoryName: "repo", directoryKey: "repo", ownerUserId: actor.id, remoteUrl: "https://example.test/team/repo.git" } });
  for (const user of [actor, other]) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions } });
  const account = await database.client.gitAccount.create({ data: { name: "开发凭据", userId: actor.id, authType: "http", remoteUrl: project.remoteUrl, host: "example.test", credentials: "not-read-by-fake-session" } });
  const workspace = await database.client.workspace.create({ data: { name: "开发空间", ownerUserId: actor.id } });
  await database.client.developmentSpace.create({ data: { projectId: project.id, userId: actor.id, workspaceId: workspace.id, gitAccountId: account.id, status: "ready" } });
  const projects = new ProjectServices(database);
  const content = new ProjectContentServices(database, projects);
  const calls = { starts: [], sends: [], images: [] };
  const sessions = {
    git: { activeReason() { return sessions.active ? "active" : null; }, async assertIdle() {} },
    store: { async read() { return {}; } },
    async validateStartSelection(selection) { return selection; },
    async start(input) {
      calls.starts.push(input);
      const recorded = await database.client.developmentTask.findUnique({ where: { id: input.requestId } });
      assert.equal(recorded.status, "unknown", "durable task intent precedes Codex dispatch");
      assert.equal(await database.client.taskIssueLink.count({ where: { taskId: input.requestId } }), (input.content.match(/--- 项目事项/g) || []).length);
      return { key: runKey({ channel: "manual", scope: "local", id: input.requestId }), accepted: true };
    },
    async exclusive(_key, operation) { return operation(); },
    async sendInput(key, input, beforeDispatch) {
      if (sessions.preflightFailure) throw new Error("会话尚未空闲");
      await beforeDispatch();
      calls.sends.push({ key, input });
      if (sessions.dispatchFailure) throw new Error("RPC outcome unknown");
      return { turnId: "turn-added", dispatchedTurnId: "turn-added" };
    },
    async uploadMessageImage(_key, bytes) { calls.images.push(bytes); return { id: randomUUID() }; },
    async messageImagePath(_key, id) { return `fake-image-${id}.png`; },
  };
  const workspaces = { async get(id, selected) {
    assert.equal(id, workspace.id);
    assert.equal(selected.id, actor.id);
    return { sessions, channels: { get: () => ({ async resolve() {}, async uploadImage(bytes) { calls.images.push(bytes); return { id: randomUUID() }; } }) } };
  } };
  const services = new ProjectDevelopmentServices(database, projects, workspaces);
  const issue = async title => {
    const created = await content.createIssue(project.id, actor, { type: "requirement", title, description: `${title}内容`, acceptanceCriteria: "明确验收标准" });
    await database.client.projectIssue.update({ where: { id: created.id }, data: { status: "planned" } });
    return { ...created, status: "planned" };
  };
  return { database, actor, other, project, content, services, sessions, calls, issue };
}

test("project tasks and image additions use the real session manager with temporary Git and fake Codex", async t => {
  let workspaces;
  t.after(async () => workspaces?.close());
  const { database, actor, project, content, issue } = await fixture(t);
  const root = database.dataRoot;
  const repository = path.join(root, "repository");
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "original");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  const remote = path.join(root, "remote.git");
  execFileSync("git", ["clone", "--bare", repository, remote], { windowsHide: true, stdio: "pipe" });
  git("remote", "add", "origin", remote);
  fs.writeFileSync(path.join(repository, "tracked.txt"), "preserve dirty root");
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => method === "thread/items/list" ? { data: [], nextCursor: null } : request(method, params);
  workspaces = new WorkspaceManager({ database, directory: path.join(root, "workspaces"), createManager: options => new SessionManager({ ...options, client }) });
  const projects = new ProjectServices(database, { workspaces });
  workspaces.authorizeProject = (id, user, permission) => projects.workspaceAuthorization(id, user, permission);
  const space = await database.client.developmentSpace.findUnique({ where: { projectId_userId: { projectId: project.id, userId: actor.id } } });
  await database.writeDocument(path.join(root, "system-settings.json"), { memberStorageRoot: path.join(root, "trees") });
  await database.writeWorkspace(space.workspaceId, { version: 6, workspace: { id: space.workspaceId, name: "真实引擎开发空间", owner_user_id: actor.id, owner_username: actor.username, project_id: project.id },
    agent: { provider: "codex" }, execution: { repository, projectName: project.directoryName, baseBranch: "main", initCommands: [] } });
  const services = new ProjectDevelopmentServices(database, projects, workspaces);
  const first = await issue("图示需求"), added = await issue("追加图示");
  const personalTemplate = "个人需求模板 {{title}}\n{{content}}\n{{images}}";
  await projects.savePrompts(project.id, actor, { scope: "personal", revision: 1, templates: { requirement: personalTemplate, supplement: "本轮补充 {{title}}\n{{content}}" } });
  for (const selected of [first, added]) await content.updateIssue(project.id, selected.id, actor, { revision: 1, attachments: [{ id: randomUUID(), name: "资料.png", mimeType: "image/png", data: png.toString("base64") }] });
  const { task } = await launch(services, project.id, actor, { requestId: randomUUID(), issueIds: [first.id] }, { supplementaryPrompt: "验证首轮补充 $& {{content}}" });
  const { sessions } = await workspaces.get(space.workspaceId, actor);
  const runtime = sessions.sessions.get(task.runKey);
  const deadline = Date.now() + 10000;
  while (!runtime.turnId && !runtime.error && Date.now() < deadline) await immediate();
  assert.ok(runtime.turnId, runtime.error || "fake Codex turn did not start");
  assert.equal(client.calls.find(call => call.method === "turn/start").params.input.filter(part => part.type === "localImage").length, 1);
  const firstText = client.calls.find(call => call.method === "turn/start").params.input[0].text;
  assert.match(firstText, /个人需求模板 图示需求/);
  assert.equal(firstText.match(/个人需求模板/g).length, 1, "project prompts are not wrapped in a second template");
  assert.ok(firstText.includes("本轮补充 图示需求\n验证首轮补充 $& {{content}}"));
  client.notify("turn/completed", { turn: { id: runtime.turnId, status: "completed" } });
  await sessions.events.drain();
  await runtime.operation;
  const state = await sessions.store.read(task.runKey);
  assert.ok(state.worktree.path.startsWith(path.join(root, "trees", "projects", project.directoryName, "members", actor.username)));
  assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "preserve dirty root");
  await database.client.projectIssue.update({ where: { id: first.id }, data: { status: "pending_verification" } });
  const requestId = randomUUID();
  await projects.savePrompts(project.id, actor, { scope: "personal", revision: 2, templates: { requirement: "追加模板 {{title}}\n{{content}}\n{{images}}" } });
  await services.append(project.id, task.id, actor, { requestId, issueIds: [added.id] });
  await projects.savePrompts(project.id, actor, { scope: "personal", revision: 3, templates: { requirement: "后续修改 {{title}}\n{{content}}\n{{images}}" } });
  assert.equal((await sessions.store.readTask(task.runKey)).prompt, firstText, "settings never rewrite a started task snapshot");
  const sent = await services.continueAddition(project.id, task.id, actor, requestId);
  assert.match(client.calls.filter(call => call.method === "turn/start").at(-1).params.input[0].text, /追加模板 追加图示/);
  assert.doesNotMatch(client.calls.filter(call => call.method === "turn/start").at(-1).params.input[0].text, /验证首轮补充/);
  await sessions.events.drain();
  assert.equal(sent.task.additions[0].status, "sent");
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 2);
  assert.equal(client.calls.filter(call => call.method === "turn/start").at(-1).params.input.filter(part => part.type === "localImage").length, 1);
  assert.equal((await content.readIssue(project.id, first.id, actor)).status, "pending_verification");
  client.notify("turn/completed", { turn: { id: runtime.turnId, status: "completed" } });
  await sessions.events.drain();
  const latest = (await services.read(project.id, task.id, actor)).task;
  await services.finish(project.id, task.id, actor, { revision: latest.revision }, "completed");
  await assert.rejects(sessions.send(task.runKey, "不能重启已结束任务", []), /开发任务已结束/);
  await assert.rejects(sessions.respond(task.runKey, "old-approval", {}), /开发任务已结束/);
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 2);
  const password = "fixture-lifecycle-password";
  await database.client.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(password) } });
  const app = createWebServer({ database, workspaces });
  t.after(() => app.close());
  const origin = await app.listen(0);
  let cookie = "", token = "";
  const http = async (url, input) => {
    const response = await fetch(origin + url, { method: input ? "POST" : "GET", headers: { cookie, "x-csrf-token": token, "content-type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
    const data = await response.json();
    if (data.token) token = data.token;
    return { status: response.status, data };
  };
  await http("/api/auth/session");
  assert.equal((await http("/api/auth/login", { username: actor.username, password })).status, 200);
  assert.equal((await http("/api/runs", { channel: "manual" })).status, 404);
  assert.equal((await http(`/api/workspaces/${task.workspaceId}/runs`, { channel: "manual" })).status, 403);
  for (const [action, body] of [["messages", { text: "禁止再次启动", images: [] }], ["responses", { requestId: "old", decision: "accept" }]]) {
    const denied = await http(`/api/workspaces/${task.workspaceId}/runs/${task.runKey}/${action}`, body);
    assert.equal(denied.status, 409, JSON.stringify(denied));
  }
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 2);
  const manualImage = await (await workspaces.get(space.workspaceId, actor)).channels.get("manual").uploadImage(png);
  const manualInput = { requestId: randomUUID(), title: "独立重构", content: `## 开发目标\n\n不关联事项，验证接口与响应式布局。\n\n![参考图片](manual-image:${manualImage.id})`, baseBranch: "main", images: [manualImage.id] };
  const manualResponse = await http(`/api/projects/${project.id}/tasks/manual`, manualInput);
  assert.equal(manualResponse.status, 202, JSON.stringify(manualResponse));
  const manualTask = manualResponse.data.task;
  assert.equal(manualTask.status, "started");
  assert.equal(manualTask.kind, "manual");
  assert.deepEqual(manualTask.issueIds, []);
  assert.equal(await database.client.taskIssueLink.count({ where: { taskId: manualTask.id } }), 0);
  assert.equal(await database.client.issueDevelopmentClaim.count({ where: { taskId: manualTask.id } }), 0);
  const manualRuntime = sessions.sessions.get(manualTask.runKey);
  const manualDeadline = Date.now() + 10000;
  while (!manualRuntime.turnId && !manualRuntime.error && Date.now() < manualDeadline) await immediate();
  assert.ok(manualRuntime.turnId, manualRuntime.error || "independent fake turn did not start");
  const manualTurn = client.calls.filter(call => call.method === "turn/start").at(-1);
  assert.match(manualTurn.params.input[0].text, /独立重构/);
  assert.equal(manualTurn.params.input.filter(part => part.type === "localImage").length, 1);
  assert.equal((await http(`/api/projects/${project.id}/tasks/manual`, manualInput)).data.reused, true);
  assert.equal((await http(`/api/projects/${project.id}/tasks/manual`, { ...manualInput, content: "不能改写已启动目标" })).status, 409);
  assert.equal((await http(`/api/projects/${project.id}/tasks/manual?requestId=${manualInput.requestId}`)).data.task.id, manualTask.id);
  await assert.rejects(services.append(project.id, manualTask.id, actor, { requestId: randomUUID(), issueIds: [first.id] }), /独立开发任务不关联/);
  client.notify("turn/completed", { threadId: manualRuntime.sessionId, turn: { id: manualRuntime.turnId, status: "completed" } });
  await sessions.events.drain();
  await manualRuntime.operation;
  const manualDetail = await http(`/api/workspaces/${space.workspaceId}/runs/${manualTask.runKey}`);
  assert.equal(manualDetail.status, 200);
  assert.ok(manualDetail.data.requirement.markdown.includes(manualInput.content), "session reload preserves the original Markdown image reference inside the rendered prompt");
  assert.equal(manualDetail.data.requirement.images[0].source, `manual-image:${manualImage.id}`);
  assert.equal(manualDetail.data.requirement.images[0].url, `/api/workspaces/${space.workspaceId}/runs/${manualTask.runKey}/images/0`);
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 3);
  const beforeInvalid = await database.client.developmentTask.count();
  const missingImage = await http(`/api/projects/${project.id}/tasks/manual`, { ...manualInput, requestId: randomUUID(), images: [randomUUID()] });
  assert.ok(missingImage.status >= 400);
  assert.equal(await database.client.developmentTask.count(), beforeInvalid, "missing images fail before accepting dispatch");
  const changedIssue = await issue("等待期间业务状态改变");
  const prepareTurn = sessions.agent.prepareTurn.bind(sessions.agent);
  sessions.agent.prepareTurn = async (...args) => {
    const prepared = await prepareTurn(...args);
    await database.client.projectIssue.update({ where: { id: changedIssue.id }, data: { status: "pending_verification" } });
    return prepared;
  };
  const changedTask = (await launch(services, project.id, actor, { requestId: randomUUID(), issueIds: [changedIssue.id] })).task;
  await sessions.sessions.get(changedTask.runKey).operation;
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 3, "workflow is checked again after waiting for Agent preparation");
  assert.equal((await services.read(project.id, changedTask.id, actor)).task.execution.status, "failed");
});

test("independent dispatch records no planned task or claim, freezes retries and preserves uncertain results", async t => {
  const { database, actor, other, project, services, sessions, calls } = await fixture(t);
  const input = { requestId: randomUUID(), title: "独立开发", content: "目标与验收标准", baseBranch: "main", images: [] };
  const result = await services.startManual(project.id, actor, input);
  assert.equal(result.task.status, "started");
  assert.equal(result.task.kind, "manual");
  assert.equal(result.task.releaseId, null);
  assert.deepEqual(result.task.issueIds, []);
  assert.equal(await database.client.projectIssue.count(), 0);
  assert.equal(await database.client.issueDevelopmentClaim.count(), 0);
  assert.equal(await database.client.developmentTask.count({ where: { status: "planned" } }), 0);
  assert.equal(calls.starts.length, 1);
  assert.equal(Object.hasOwn(calls.starts[0], "metadata"), false);
  assert.equal((await services.startManual(project.id, actor, input)).reused, true);
  await assert.rejects(services.startManual(project.id, actor, { ...input, baseBranch: "release/1" }), { statusCode: 409 });
  assert.equal((await services.readManual(project.id, other, { requestId: input.requestId })).task, null, "another developer cannot recover a private request");
  const execute = sessions.start;
  sessions.start = async request => { await execute(request); throw new Error("lost dispatch acknowledgement"); };
  const unknownInput = { ...input, requestId: randomUUID() };
  const unknown = await services.startManual(project.id, actor, unknownInput);
  assert.equal(unknown.task.status, "unknown");
  assert.match(unknown.task.error, /lost dispatch acknowledgement/);
  assert.equal((await services.startManual(project.id, actor, unknownInput)).reused, true);
  assert.equal(calls.starts.length, 2, "uncertain starts never replay");
  assert.equal((await services.readManual(project.id, actor, { requestId: unknownInput.requestId })).task.id, unknown.task.id);
  await database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: actor.id } }, data: { permissions: ["project.view", "issue.view"] } });
  await assert.rejects(services.startManual(project.id, actor, input), { statusCode: 403 });
  assert.equal(calls.starts.length, 2);
});

test("project additions persist ready snapshots without sending and fence unknown outcomes against replay", async t => {
  const { actor, project, content, services, sessions, calls, issue } = await fixture(t);
  const first = await issue("原始事项"), added = await issue("追加事项"), uncertain = await issue("不确定追加");
  const { task } = await launch(services, project.id, actor, { requestId: randomUUID(), issueIds: [first.id] });
  const requestId = randomUUID();
  const prepared = await services.append(project.id, task.id, actor, { requestId, issueIds: [added.id] });
  assert.equal(prepared.task.additions[0].status, "ready");
  assert.equal(calls.sends.length, 0);
  await content.updateIssue(project.id, added.id, actor, { revision: prepared.task.additions[0].issues[0].revision, description: "新编辑不改快照" });
  sessions.preflightFailure = true;
  await assert.rejects(services.continueAddition(project.id, task.id, actor, requestId), /尚未空闲/);
  assert.equal((await services.read(project.id, task.id, actor)).task.additions[0].status, "ready");
  sessions.preflightFailure = false;
  await services.continueAddition(project.id, task.id, actor, requestId);
  assert.match(calls.sends[0].input[0].text, /追加事项内容/);
  assert.doesNotMatch(calls.sends[0].input[0].text, /新编辑不改快照/);
  await assert.rejects(services.continueAddition(project.id, task.id, actor, requestId), /不能重复/);
  sessions.dispatchFailure = true;
  const failedRequest = randomUUID();
  await assert.rejects(services.append(project.id, task.id, actor, { requestId: failedRequest, issueIds: [uncertain.id], send: true }), /unknown/);
  assert.equal((await services.read(project.id, task.id, actor)).task.additions[1].status, "unknown");
  await assert.rejects(services.continueAddition(project.id, task.id, actor, failedRequest), /不能重复/);
  assert.equal(calls.sends.length, 2);
  assert.equal((await content.readIssue(project.id, uncertain.id, actor)).status, "planned");
});


test("start supplements use executor templates, freeze at dispatch and fence changed retries", async t => {
  const { database, actor, other, project, services, calls, issue } = await fixture(t);
  const selected = await issue("启动补充要求");
  const task = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] })).tasks[0];
  const space = await database.client.developmentSpace.findUnique({ where: { projectId_userId: { projectId: project.id, userId: actor.id } } });
  await database.writeWorkspace(space.workspaceId, { version: 6, workspace: { id: space.workspaceId, name: "补充提示词测试空间", owner_user_id: actor.id, owner_username: actor.username, project_id: project.id },
    agent: { provider: "codex" }, execution: { repository: database.dataRoot, projectName: project.directoryName, baseBranch: "main", initCommands: [] } });
  const projects = services.projects;
  await projects.savePrompts(project.id, actor, { scope: "project", revision: project.revision, templates: { supplement: "项目补充 {{content}}" } });
  await projects.savePrompts(project.id, actor, { scope: "personal", revision: 1, templates: { supplement: "{{content}}{{content}}{{content}}{{content}}" } });
  const request = { requestId: randomUUID(), revision: task.revision, baseBranch: "main", supplementaryPrompt: "保留字面内容 $& {{title}}\n验证移动端" };
  await assert.rejects(services.start(project.id, task.id, other, request), { statusCode: 403 });
  await assert.rejects(services.start(project.id, task.id, actor, { ...request, supplementaryPrompt: "a".repeat(20000) }), /超过 60000/);
  assert.equal((await services.read(project.id, task.id, actor)).task.status, "planned");
  assert.equal(calls.starts.length, 0, "invalid rendered content is rejected before recording or dispatch");
  await projects.savePrompts(project.id, actor, { scope: "personal", revision: 2, templates: { supplement: "个人补充 {{title}}\n{{content}}" } });
  await services.start(project.id, task.id, actor, request);
  const prompt = calls.starts[0].content;
  assert.ok(prompt.endsWith(`个人补充 启动补充要求\n${request.supplementaryPrompt}`));
  assert.equal(prompt.match(/个人补充/g).length, 1);
  assert.doesNotMatch(prompt, /项目补充/);
  const snapshot = (await database.client.developmentTask.findUnique({ where: { id: task.id } })).snapshot;
  assert.equal(snapshot.supplementaryPrompt, request.supplementaryPrompt);
  assert.equal(snapshot.startRequest.supplementaryPrompt, request.supplementaryPrompt);
  await projects.savePrompts(project.id, actor, { scope: "personal", revision: 3, templates: { supplement: "后续模板 {{content}}" } });
  assert.equal((await services.start(project.id, task.id, actor, request)).reused, true);
  await assert.rejects(services.start(project.id, task.id, actor, { ...request, supplementaryPrompt: "改动请求" }), { statusCode: 409 });
  assert.equal(calls.starts.length, 1);
  assert.equal((await database.client.developmentTask.findUnique({ where: { id: task.id } })).snapshot.prompt, prompt);
});

async function launch(services, projectId, actor, input, startInput = {}) {
  const planned = await services.create(projectId, actor, input);
  return services.start(projectId, planned.tasks[0].id, actor, { requestId: randomUUID(), revision: planned.tasks[0].revision, baseBranch: "main", ...startInput });
}

test("assigning separate issues and merging my plans preserves sources and starts exactly one session", async t => {
  const { database, actor, other, project, services, calls, content, issue } = await fixture(t);
  const requirement = await issue("合并需求");
  const bug = await content.createIssue(project.id, actor, { type: "bug", title: "合并缺陷", reproductionSteps: "复现步骤" });
  const input = { requestId: randomUUID(), issueIds: [requirement.id, bug.id], executorId: actor.id };
  const { tasks } = await services.create(project.id, other, input);
  assert.equal(tasks.length, 2);
  assert.equal(calls.starts.length, 0);
  for (const task of tasks) {
    assert.equal(task.issueIds.length, 1);
    assert.equal(task.executorId, actor.id);
    assert.equal(task.runKey, null);
  }
  assert.equal((await services.list(project.id, other, { scope: "mine" })).tasks.length, 0);
  assert.equal((await services.list(project.id, actor, { scope: "mine" })).tasks.length, 2);
  assert.equal((await content.readIssue(project.id, requirement.id, actor)).developerId, actor.id);
  assert.equal((await services.create(project.id, other, input)).reused, true);
  await assert.rejects(services.create(project.id, other, { ...input, issueIds: [requirement.id] }), { statusCode: 409 });
  const merge = { requestId: randomUUID(), title: "统一修复", tasks: tasks.map(({ id, revision }) => ({ id, revision })) };
  await assert.rejects(services.merge(project.id, other, merge), { statusCode: 403 });
  const merged = (await services.merge(project.id, actor, merge)).task;
  assert.deepEqual(new Set(merged.issueIds), new Set(input.issueIds));
  assert.equal((await services.merge(project.id, actor, merge)).task.id, merged.id);
  await assert.rejects(services.merge(project.id, actor, { ...merge, title: "不同内容" }), { statusCode: 409 });
  assert.equal((await services.list(project.id, actor, { scope: "mine" })).tasks.length, 1);
  for (const source of tasks) {
    const historical = (await services.read(project.id, source.id, actor)).task;
    assert.equal(historical.status, "merged");
    assert.equal(historical.mergedIntoTaskId, merged.id);
    assert.equal(historical.canStart || historical.canEdit || historical.canCancel || historical.canComplete, false);
    await assert.rejects(services.finish(project.id, source.id, actor, { revision: historical.revision }, "cancelled"), { statusCode: 409 });
  }
  assert.equal(await database.client.taskIssueLink.count(), 4, "original links remain as history");
  assert.equal(await database.client.issueDevelopmentClaim.count({ where: { taskId: merged.id } }), 2);
  assert.equal((await content.readIssue(project.id, bug.id, actor)).development.taskId, merged.id);
  await services.projects.savePrompts(project.id, actor, { scope: "personal", revision: 1, templates: { bug: "执行人的 Bug 模板 {{title}}\n{{content}}\n{{images}}" } });
  await services.projects.savePrompts(project.id, other, { scope: "personal", revision: 1, templates: { bug: "指派人的模板 {{title}}\n{{content}}\n{{images}}" } });
  const start = { requestId: randomUUID(), revision: merged.revision, baseBranch: "main" };
  await services.start(project.id, merged.id, actor, start);
  await services.start(project.id, merged.id, actor, start);
  assert.equal(calls.starts.length, 1);
  assert.match(calls.starts[0].content, /合并需求/);
  assert.match(calls.starts[0].content, /复现步骤/);
  assert.match(calls.starts[0].content, /执行人的 Bug 模板 合并缺陷/);
  assert.match(calls.starts[0].content, /请根据以下需求完成开发/);
  assert.doesNotMatch(calls.starts[0].content, /指派人的模板/);
});

test("batch assignment and concurrent merging are atomic and reject stale or foreign plans", async t => {
  const { database, actor, other, project, services, issue } = await fixture(t);
  const first = await issue("原任务"), second = await issue("第二任务"), third = await issue("未认领");
  const { tasks } = await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [first.id, second.id] });
  await assert.rejects(services.create(project.id, other, { requestId: randomUUID(), issueIds: [third.id, first.id] }), { statusCode: 409 });
  assert.equal((await database.client.projectIssue.findUnique({ where: { id: third.id } })).developerId, null);
  assert.equal(await database.client.developmentTask.count(), 2);
  const request = { requestId: randomUUID(), title: "原子合并", tasks: tasks.map(({ id, revision }) => ({ id, revision })) };
  await assert.rejects(services.merge(project.id, actor, { ...request, tasks: [request.tasks[0], { ...request.tasks[1], revision: 999 }] }), { statusCode: 409 });
  await assert.rejects(services.merge(project.id, actor, { ...request, tasks: [request.tasks[0], { id: randomUUID(), revision: 1 }] }), { statusCode: 404 });
  const results = await Promise.allSettled([request, { ...request, requestId: randomUUID() }].map(input => services.merge(project.id, actor, input)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.statusCode, 409);
  assert.equal(await database.client.developmentTask.count({ where: { status: "planned" } }), 1);
  assert.equal(await database.client.issueDevelopmentClaim.count(), 2);
});

test("planning needs no Git, reserves each issue once, supports reassignment and preserves history on release", async t => {
  const { database, actor, other, project, services, calls, issue } = await fixture(t);
  const first = await issue("规划事项"), extra = await issue("补充事项");
  const input = { requestId: randomUUID(), issueIds: [first.id] };
  const planned = (await services.create(project.id, other, input)).tasks[0];
  assert.equal(planned.status, "planned");
  assert.equal(planned.workspaceId, null);
  assert.equal(planned.runKey, null);
  assert.equal(planned.canOpenSession, false);
  assert.equal(planned.canComplete, false);
  await assert.rejects(services.finish(project.id, planned.id, other, { revision: planned.revision }, "completed"), /只能取消/);
  assert.equal(calls.starts.length, 0);
  assert.equal((await services.create(project.id, other, input)).tasks[0].id, planned.id);
  await assert.rejects(services.create(project.id, actor, { requestId: randomUUID(), issueIds: [first.id] }), { statusCode: 409 });
  await assert.rejects(services.start(project.id, planned.id, actor, { requestId: randomUUID(), revision: planned.revision, baseBranch: "main" }), { statusCode: 403 });
  await assert.rejects(services.start(project.id, planned.id, other, { requestId: randomUUID(), revision: planned.revision, baseBranch: "main" }), /开发空间/);
  const updated = (await services.update(project.id, planned.id, actor, { revision: planned.revision, executorId: actor.id, issueIds: [first.id, extra.id], title: "重新指派" })).task;
  assert.equal(updated.executor.displayName, actor.displayName);
  await assert.rejects(services.update(project.id, planned.id, actor, { revision: planned.revision, title: "过期修订" }), { statusCode: 409 });
  assert.equal((await services.create(project.id, other, input)).tasks[0].id, planned.id, "reassignment preserves creator idempotency");
  const cancelled = (await services.finish(project.id, planned.id, actor, { revision: updated.revision }, "cancelled")).task;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await database.client.issueDevelopmentClaim.count(), 0);
  assert.equal(await database.client.taskIssueLink.count({ where: { taskId: planned.id } }), 2);
  await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [first.id] });
  assert.equal((await services.list(project.id, actor, { issueId: first.id })).tasks.length, 2);
});

test("concurrent claims and stale revisions are atomic", async t => {
  const { database, actor, other, project, services, issue } = await fixture(t);
  const first = await issue("并发认领"), extra = await issue("并发追加");
  const claims = await Promise.allSettled([actor, other].map(user => services.create(project.id, user, { requestId: randomUUID(), issueIds: [first.id] })));
  assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await database.client.issueDevelopmentClaim.count(), 1);
  const task = claims.find(result => result.status === "fulfilled").value.tasks[0];
  const edits = await Promise.allSettled([
    services.update(project.id, task.id, actor, { revision: task.revision, issueIds: [first.id, extra.id] }),
    services.finish(project.id, task.id, actor, { revision: task.revision }, "cancelled"),
  ]);
  assert.equal(edits.filter(result => result.status === "fulfilled").length, 1);
  const latest = (await services.read(project.id, task.id, actor)).task;
  assert.equal(await database.client.issueDevelopmentClaim.count(), latest.status === "cancelled" ? 0 : 2);
});

test("product planners see tasks without session access and only assign eligible members", async t => {
  const { database, actor, other, project, services, calls, issue } = await fixture(t);
  const selected = await issue("产品协作");
  await database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: other.id } }, data: { permissions: ["project.view", "issue.view", "issue.assign"] } });
  const planned = (await services.create(project.id, other, { requestId: randomUUID(), issueIds: [selected.id], executorId: actor.id })).tasks[0];
  assert.equal(planned.canStart, false);
  assert.equal(planned.canEdit, true);
  assert.equal((await services.list(project.id, other)).tasks.length, 1);
  assert.equal((await services.read(project.id, planned.id, other)).task.canOpenSession, false);
  await assert.rejects(services.create(project.id, other, { requestId: randomUUID(), issueIds: [selected.id] }), { statusCode: 403 });
  await assert.rejects(services.update(project.id, planned.id, actor, { revision: planned.revision, executorId: other.id }), { statusCode: 403 });
  assert.equal(calls.starts.length, 0);
});

test("explicit start freezes current content and selections and never replays unknown execution", async t => {
  const { database, actor, other, project, services, sessions, calls, content, issue } = await fixture(t);
  const selected = await issue("冻结快照");
  const planned = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] })).tasks[0];
  await content.updateIssue(project.id, selected.id, actor, { revision: planned.issues[0].revision, description: "开始前更新" });
  const input = { requestId: randomUUID(), revision: planned.revision, baseBranch: "main" };
  const started = (await services.start(project.id, planned.id, actor, input)).task;
  assert.equal(started.status, "started");
  assert.match(calls.starts[0].content, /开始前更新/);
  assert.equal((await services.start(project.id, planned.id, actor, input)).task.id, planned.id);
  await assert.rejects(services.start(project.id, planned.id, actor, { ...input, baseBranch: "release/2" }), { statusCode: 409 });
  await assert.rejects(services.update(project.id, planned.id, actor, { revision: started.revision, title: "不可编辑" }), { statusCode: 409 });
  const publicTask = (await services.read(project.id, planned.id, other)).task;
  assert.equal(publicTask.workspaceId, null);
  assert.equal(publicTask.runKey, null);
  await content.updateIssue(project.id, selected.id, actor, { revision: planned.issues[0].revision + 1, description: "开始后更新" });
  assert.equal((await services.read(project.id, planned.id, actor)).task.issues[0].description, "开始前更新");
  const failedIssue = await issue("启动不明");
  const failedPlan = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [failedIssue.id] })).tasks[0];
  sessions.start = async () => { throw new Error("RPC outcome unknown"); };
  const failedInput = { requestId: randomUUID(), revision: failedPlan.revision, baseBranch: "main" };
  await assert.rejects(services.start(project.id, failedPlan.id, actor, failedInput), /unknown/);
  assert.equal((await services.start(project.id, failedPlan.id, actor, failedInput)).task.status, "unknown");
  assert.equal(await database.client.issueDevelopmentClaim.count(), 2);
  assert.equal(calls.starts.length, 1);
  await database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: actor.id } }, data: { permissions: ["project.view", "issue.view"] } });
  const revoked = (await services.read(project.id, planned.id, actor)).task;
  assert.equal(revoked.workspaceId, null);
  assert.equal(revoked.runKey, null);
  assert.equal(revoked.execution, null);
  assert.equal(revoked.canOpenSession, false);
});

test("workflow and release rules gate starting and archiving independently from planning", async t => {
  const { database, actor, project, content, services, issue } = await fixture(t);
  const lifecycle = new ProjectLifecycleServices(database, services.projects);
  const release = await lifecycle.saveRelease(project.id, null, actor, { name: "v1.0" });
  const selected = await issue("版本事项"), unscheduled = await issue("未排期事项");
  await content.updateIssue(project.id, selected.id, actor, { revision: 1, releaseId: release.id });
  const batch = await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id, unscheduled.id] });
  await assert.rejects(services.merge(project.id, actor, { requestId: randomUUID(), tasks: batch.tasks.map(({ id, revision }) => ({ id, revision })), title: "跨版本合并" }), /同一发布版本/);
  for (const task of batch.tasks) await services.finish(project.id, task.id, actor, { revision: task.revision }, "cancelled");
  await database.client.projectIssue.update({ where: { id: selected.id }, data: { status: "pending_verification" } });
  const planned = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] })).tasks[0];
  await assert.rejects(services.start(project.id, planned.id, actor, { requestId: randomUUID(), revision: planned.revision, baseBranch: "main" }), /流程节点/);
  await content.updateIssue(project.id, selected.id, actor, { revision: planned.issues[0].revision, description: "普通内容可编辑" });
  await assert.rejects(content.updateIssue(project.id, selected.id, actor, { revision: planned.issues[0].revision + 1, releaseId: null }), /开发任务/);
  await database.client.projectIssue.update({ where: { id: selected.id }, data: { status: "implemented" } });
  await assert.rejects(lifecycle.archiveRelease(project.id, release.id, actor, { revision: release.revision }, true), /开发任务/);
  await services.finish(project.id, planned.id, actor, { revision: planned.revision }, "cancelled");
  await lifecycle.archiveRelease(project.id, release.id, actor, { revision: release.revision }, true);
  await assert.rejects(services.create(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] }), /归档/);
});

test("running execution and pending approvals prevent completing a task and releasing its claim", async t => {
  const { database, actor, project, services, sessions, content, issue } = await fixture(t);
  const selected = await issue("执行门禁");
  const task = (await launch(services, project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] })).task;
  const runPath = path.join(database.dataRoot, "workspaces", task.workspaceId, "runs", task.runKey, "run.json");
  await database.writeDocument(runPath, { execution: { status: "running" } });
  await assert.rejects(services.finish(project.id, task.id, actor, { revision: task.revision }, "completed"), /执行/);
  await database.writeDocument(runPath, { execution: { status: "completed" } });
  sessions.active = true;
  await assert.rejects(services.finish(project.id, task.id, actor, { revision: task.revision }, "cancelled"), /审批/);
  sessions.active = false;
  assert.equal((await services.finish(project.id, task.id, actor, { revision: task.revision }, "completed")).task.status, "completed");
  assert.equal(await database.client.issueDevelopmentClaim.count(), 0);
  assert.equal(await database.client.taskIssueLink.count(), 1);
  const listed = await content.listIssues(project.id, actor, {});
  assert.equal(listed.items[0].developerId, actor.id, "completion retains the responsible developer");
  assert.equal(listed.items[0].development, null, "completion releases only the active task claim");
  assert.equal(listed.people.find(person => person.id === actor.id)?.displayName, actor.displayName);
  const reopened = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] })).tasks[0];
  await services.finish(project.id, reopened.id, actor, { revision: reopened.revision }, "cancelled");
  const cancelled = await content.listIssues(project.id, actor, {});
  assert.equal(cancelled.items[0].developerId, null, "cancellation clears the responsible developer");
  assert.ok(cancelled.people.some(person => person.id === actor.id), "business owner remains in the people directory");
});

test("global workflow publication preserves planned task issue versions and applies the same development gates across projects", async t => {
  const { database, actor, other, project, content, services, calls } = await fixture(t);
  const accounts = new AccountServices(database);
  t.after(() => accounts.close());
  const admin = await database.client.user.create({ data: { username: "workflow-admin", displayName: "系统流程管理员", passwordHash: "unused", role: "admin" } });
  const workflows = new SystemWorkflowServices(database, accounts, services.projects);
  const before = await content.createIssue(project.id, actor, { type: "requirement", title: "发布前规划" });
  const beforeTask = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [before.id] })).tasks[0];
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  const definition = {
    nodes: [
      { id: "triage", name: "待分诊", kind: "initial", allowDevelopment: false },
      { id: "development", name: "可开发", kind: "normal", allowDevelopment: true },
      { id: "done", name: "已完成", kind: "completed", allowDevelopment: false },
    ],
    transitions: [
      { id: "approve", from: "triage", to: "development", name: "允许开发", permission: "issue.transition", requiresReason: false },
      { id: "finish", from: "development", to: "done", name: "验收完成", permission: "issue.accept", requiresReason: false },
    ],
  };
  await assert.rejects(workflows.saveWorkflow("requirement", actor, { revision: workflow.revision, definition }), { statusCode: 403 });
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true);
  assert.equal((await services.start(project.id, beforeTask.id, actor, { requestId: randomUUID(), revision: beforeTask.revision, baseBranch: "main" })).task.status, "started");
  assert.equal((await content.readIssue(project.id, before.id, actor)).status, "planned");
  const nextProject = await database.client.project.create({ data: { name: "统一流程项目", directoryName: "repo-other", directoryKey: "repo-other", ownerUserId: actor.id, remoteUrl: project.remoteUrl } });
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  await database.client.projectMember.create({ data: { projectId: nextProject.id, userId: actor.id, permissions } });
  const firstNew = await content.createIssue(project.id, actor, { type: "requirement", title: "原项目新流程事项" });
  const secondNew = await content.createIssue(nextProject.id, actor, { type: "requirement", title: "另一项目新流程事项" });
  assert.equal(firstNew.status, "triage");
  assert.equal(secondNew.status, "triage");
  const firstRecord = await database.client.projectIssue.findUnique({ where: { id: firstNew.id } });
  const secondRecord = await database.client.projectIssue.findUnique({ where: { id: secondNew.id } });
  const beforeRecord = await database.client.projectIssue.findUnique({ where: { id: before.id } });
  assert.equal(firstRecord.workflowVersionId, secondRecord.workflowVersionId, "projects bind the same immutable system workflow version");
  assert.notEqual(beforeRecord.workflowVersionId, firstRecord.workflowVersionId);
  const newTask = (await services.create(project.id, actor, { requestId: randomUUID(), issueIds: [firstNew.id] })).tasks[0];
  await assert.rejects(services.start(project.id, newTask.id, actor, { requestId: randomUUID(), revision: newTask.revision, baseBranch: "main" }), /流程节点/);
  await content.transitionIssue(project.id, firstNew.id, actor, { revision: newTask.issues[0].revision, transitionId: "approve" });
  await services.start(project.id, newTask.id, actor, { requestId: randomUUID(), revision: newTask.revision, baseBranch: "main" });
  assert.equal(calls.starts.length, 2);
  const publicTask = (await services.read(project.id, newTask.id, other)).task;
  assert.equal(publicTask.runKey, null);
  assert.equal(publicTask.workspaceId, null);
  await assert.rejects(services.create(project.id, actor, { requestId: randomUUID(), issueIds: [secondNew.id] }), { statusCode: 404 });
});
