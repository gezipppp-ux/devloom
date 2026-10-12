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

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  const department = await database.client.department.create({ data: { name: "开发测试", permissions } });
  const actor = await database.client.user.create({ data: { username: "developer", passwordHash: "unused", departmentId: department.id } });
  const other = await database.client.user.create({ data: { username: "other-dev", passwordHash: "unused", departmentId: department.id } });
  const repository = await database.client.repository.create({ data: { name: "开发仓库", remoteUrl: "https://example.test/repo.git" } });
  const project = await database.client.project.create({ data: { name: "开发项目", ownerUserId: actor.id, departmentId: department.id, repositoryId: repository.id } });
  for (const user of [actor, other]) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions } });
  const account = await database.client.gitAccount.create({ data: { name: "开发凭据", userId: actor.id, authType: "http", remoteUrl: repository.remoteUrl, host: "example.test", credentials: "not-read-by-fake-session" } });
  const workspace = await database.client.workspace.create({ data: { name: "开发空间", ownerUserId: actor.id } });
  await database.client.developmentSpace.create({ data: { projectId: project.id, userId: actor.id, workspaceId: workspace.id, gitAccountId: account.id, status: "ready" } });
  const projects = new ProjectServices(database);
  const content = new ProjectContentServices(database, projects);
  const calls = { starts: [], sends: [], images: [] };
  const sessions = {
    async start(input) {
      calls.starts.push(input);
      const recorded = await database.client.developmentTask.findUnique({ where: { id: input.requestId } });
      assert.equal(recorded.status, "dispatching", "durable task intent precedes Codex dispatch");
      assert.equal(await database.client.taskIssueLink.count({ where: { taskId: input.requestId } }), input.content.match(/--- 项目事项/g).length);
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
    return { sessions, channels: { get: () => ({ async uploadImage(bytes) { calls.images.push(bytes); return { id: randomUUID() }; } }) } };
  } };
  const services = new ProjectDevelopmentServices(database, projects, workspaces);
  const issue = async title => content.createIssue(project.id, actor, { type: "requirement", title, description: `${title}内容`, acceptanceCriteria: "明确验收标准" });
  return { database, actor, other, project, content, services, sessions, calls, issue };
}

test("explicit project development captures immutable multi-issue snapshots, permits multiple tasks per issue, and never injects assets", async t => {
  const { database, actor, other, project, content, services, calls, issue } = await fixture(t);
  const first = await issue("需求甲"), second = await issue("需求乙");
  const privateAsset = await content.saveAsset(project.id, null, actor, { type: "token", title: "不进入模型的资产", secret: "never-inject-project-secret", content: "private-asset-content" });
  await content.uploadFile(project.id, "assets", privateAsset.id, actor, { name: "private.png", mimeType: "image/png", data: png });
  const input = { requestId: randomUUID(), issueIds: [first.id, second.id], title: "融合开发" };
  const { task } = await services.start(project.id, actor, input);
  assert.equal(task.status, "started");
  assert.equal(task.canOpenSession, true);
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.images.length, 0);
  assert.match(calls.starts[0].content, /需求甲内容[\s\S]*需求乙内容/);
  assert.doesNotMatch(JSON.stringify(calls), /never-inject-project-secret|private-asset-content/);
  await content.updateIssue(project.id, first.id, actor, { revision: 1, description: "后续修改" });
  assert.equal((await services.read(project.id, task.id, actor)).task.issues[0].description, "需求甲内容");
  assert.equal((await services.start(project.id, actor, input)).task.id, task.id);
  assert.equal(calls.starts.length, 1);
  await assert.rejects(services.start(project.id, actor, { ...input, issueIds: [first.id] }), /相同请求/);
  await services.start(project.id, actor, { requestId: randomUUID(), issueIds: [first.id] });
  assert.equal(await database.client.taskIssueLink.count({ where: { issueId: first.id } }), 2);
  assert.equal((await services.list(project.id, actor, { issueId: first.id })).tasks.length, 2);
  assert.equal((await services.list(project.id, actor, { issueId: second.id })).tasks.length, 1);
  assert.equal((await content.readIssue(project.id, first.id, actor)).status, "review");
  assert.equal((await services.read(project.id, task.id, other)).task.canOpenSession, false);
  await assert.rejects(services.append(project.id, task.id, other, { requestId: randomUUID(), issueIds: [first.id] }), /自己的开发空间/);
});

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
  fs.writeFileSync(path.join(repository, "tracked.txt"), "preserve dirty root");
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => method === "thread/items/list" ? { data: [], nextCursor: null } : request(method, params);
  workspaces = new WorkspaceManager({ database, directory: path.join(root, "workspaces"), createManager: options => new SessionManager({ ...options, client }) });
  const projects = new ProjectServices(database, { workspaces });
  workspaces.authorizeProject = (id, user, permission) => projects.workspaceAuthorization(id, user, permission);
  const space = await database.client.developmentSpace.findUnique({ where: { projectId_userId: { projectId: project.id, userId: actor.id } } });
  await database.writeDocument(path.join(root, "system-settings.json"), { memberStorageRoot: path.join(root, "trees") });
  await database.writeWorkspace(space.workspaceId, { workspace: { id: space.workspaceId, name: "真实引擎开发空间", owner_user_id: actor.id, project_id: project.id },
    agent: { provider: "codex" }, execution: { repository, projectName: project.id, baseRef: "main", initCommands: [] } });
  const services = new ProjectDevelopmentServices(database, projects, workspaces);
  const first = await issue("图示需求"), added = await issue("追加图示");
  for (const selected of [first, added]) await content.updateIssue(project.id, selected.id, actor, { revision: 1, attachments: [{ id: randomUUID(), name: "资料.png", mimeType: "image/png", data: png.toString("base64") }] });
  const { task } = await services.start(project.id, actor, { requestId: randomUUID(), issueIds: [first.id] });
  const { sessions } = await workspaces.get(space.workspaceId, actor);
  const runtime = sessions.sessions.get(task.runKey);
  const deadline = Date.now() + 10000;
  while (!runtime.turnId && !runtime.error && Date.now() < deadline) await immediate();
  assert.ok(runtime.turnId, runtime.error || "fake Codex turn did not start");
  assert.equal(client.calls.find(call => call.method === "turn/start").params.input.filter(part => part.type === "localImage").length, 1);
  client.notify("turn/completed", { turn: { id: runtime.turnId, status: "completed" } });
  await sessions.events.drain();
  await runtime.operation;
  const state = await sessions.store.read(task.runKey);
  assert.ok(state.worktree.path.startsWith(path.join(root, "trees", "projects", project.id, "members", actor.id)));
  assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "preserve dirty root");
  const requestId = randomUUID();
  await services.append(project.id, task.id, actor, { requestId, issueIds: [added.id] });
  const sent = await services.continueAddition(project.id, task.id, actor, requestId);
  await sessions.events.drain();
  assert.equal(sent.task.additions[0].status, "sent");
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, 2);
  assert.equal(client.calls.filter(call => call.method === "turn/start").at(-1).params.input.filter(part => part.type === "localImage").length, 1);
  assert.equal((await content.readIssue(project.id, first.id, actor)).status, "review");
});

test("project additions persist ready snapshots without sending and fence unknown outcomes against replay", async t => {
  const { actor, project, content, services, sessions, calls, issue } = await fixture(t);
  const first = await issue("原始事项"), added = await issue("追加事项"), uncertain = await issue("不确定追加");
  const { task } = await services.start(project.id, actor, { requestId: randomUUID(), issueIds: [first.id] });
  const requestId = randomUUID();
  const prepared = await services.append(project.id, task.id, actor, { requestId, issueIds: [added.id] });
  assert.equal(prepared.task.additions[0].status, "ready");
  assert.equal(calls.sends.length, 0);
  await content.updateIssue(project.id, added.id, actor, { revision: 1, description: "新编辑不改快照" });
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
  assert.equal((await content.readIssue(project.id, uncertain.id, actor)).status, "review");
});

test("revoked members and absent development spaces cannot start project tasks", async t => {
  const { database, actor, other, project, services, calls, issue } = await fixture(t);
  const selected = await issue("权限校验");
  await assert.rejects(services.start(project.id, other, { requestId: randomUUID(), issueIds: [selected.id] }), /开发空间/);
  await database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: actor.id } }, data: { status: "inactive" } });
  await assert.rejects(services.start(project.id, actor, { requestId: randomUUID(), issueIds: [selected.id] }), { statusCode: 404 });
  assert.equal(calls.starts.length, 0);
  assert.equal(await database.client.developmentTask.count(), 0);
});
