const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { setImmediate: immediate } = require("node:timers/promises");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");
const { WorkbenchServices } = require("../../src/application/workbench-services.cjs");

async function fixture(t, count = 1) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(item => item.scope === "project").map(item => item.id);
  const department = await database.client.department.create({ data: { name: "Rework", permissions } });
  const actor = await database.client.user.create({ data: { username: "developer", displayName: "Developer", passwordHash: "unused", departmentId: department.id } });
  const qa = await database.client.user.create({ data: { username: "reviewer", displayName: "Reviewer", passwordHash: "unused", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "Rework", directoryName: "rework", directoryKey: "rework", ownerUserId: actor.id, remoteUrl: "https://example.test/rework.git" } });
  for (const user of [actor, qa]) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions } });
  const account = await database.client.gitAccount.create({ data: { name: "Fixture", userId: actor.id, authType: "http", remoteUrl: project.remoteUrl, host: "example.test", credentials: "unused" } });
  const workspace = await database.client.workspace.create({ data: { name: "Rework", ownerUserId: actor.id } });
  await database.client.developmentSpace.create({ data: { projectId: project.id, userId: actor.id, workspaceId: workspace.id, gitAccountId: account.id, status: "ready" } });
  const root = database.dataRoot, repository = path.join(root, "repository"), remote = path.join(root, "remote.git");
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { windowsHide: true, stdio: "pipe" });
  git("init", "-b", "main"); fs.writeFileSync(path.join(repository, "code.txt"), "delivered code"); git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  execFileSync("git", ["clone", "--bare", repository, remote], { windowsHide: true, stdio: "pipe" }); git("remote", "add", "origin", remote);
  await database.writeDocument(path.join(root, "system-settings.json"), { memberStorageRoot: path.join(root, "trees") });
  await database.writeWorkspace(workspace.id, { version: 6, workspace: { id: workspace.id, name: "Rework", owner_user_id: actor.id, owner_username: actor.username, project_id: project.id }, agent: { provider: "codex" }, execution: { repository, projectName: project.directoryName, baseBranch: "main", initCommands: [] } });
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = (method, params) => method === "thread/items/list" ? Promise.resolve({ data: [], nextCursor: null }) : request(method, params);
  const workspaces = new WorkspaceManager({ database, directory: path.join(root, "workspaces"), createManager: options => new SessionManager({ ...options, client }) });
  t.after(() => workspaces.close());
  const projects = new ProjectServices(database, { workspaces });
  workspaces.authorizeProject = (id, user, permission) => projects.workspaceAuthorization(id, user, permission);
  const development = new ProjectDevelopmentServices(database, projects, workspaces), content = new ProjectContentServices(database, projects);
  const issues = [];
  for (let i = 0; i < count; i++) issues.push(await content.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "requirement", title: "Rework " + i, description: "Implement", acceptanceCriteria: ["Verified"], qaOwnerId: qa.id }));
  const planned = (await development.create(project.id, actor, { requestId: randomUUID(), issueIds: issues.map(issue => issue.id) })).tasks;
  let task = planned.length === 1 ? planned[0] : (await development.merge(project.id, actor, { requestId: randomUUID(), title: "Combined rework", tasks: planned.map(({ id, revision }) => ({ id, revision })) })).task;
  const { sessions } = await workspaces.get(workspace.id, actor);
  const waitTurn = async key => {
    const runtime = sessions.sessions.get(key), deadline = Date.now() + 10000;
    while (!runtime.turnId && !runtime.error && Date.now() < deadline) await immediate();
    assert.ok(runtime.turnId, runtime.error || "Fake turn did not start");
    return runtime;
  };
  const start = async current => {
    const result = (await development.start(project.id, current.id, actor, { requestId: randomUUID(), revision: current.revision, baseBranch: "main" })).task;
    await waitTurn(result.runKey); return result;
  };
  task = await start(task);
  const end = async (key = task.runKey) => {
    const runtime = await waitTurn(key);
    client.notify("turn/completed", { threadId: runtime.sessionId, turn: { id: runtime.turnId, status: "completed" } });
    await sessions.events.drain(); await runtime.operation;
  };
  const submit = (issue = issues[0], taskId = task.id, extra = {}) => content.addDeliverable(project.id, actor, { requestId: randomUUID(), issueId: issue.id, taskId, reviewerId: qa.id, title: issue.title, body: "Original delivery evidence", commit: "fixture-commit", ...extra });
  const review = (delivery, status) => content.reviewDeliverable(project.id, delivery.id, qa, { revision: delivery.revision, status, checkedItems: status === "accepted" ? delivery.checklist.map((_, i) => i) : [], reviewNote: status === "returned" ? "Fix the edge case" : "Verified" });
  await end();
  return { database, actor, qa, project, issues, task, development, content, sessions, client, projects, workspaces, start, end, submit, review };
}

test("delivery and acceptance allow continuation without changing workflow; active deletion is still blocked", async t => {
  const f = await fixture(t), { task, sessions } = f;
  let delivery = await f.submit();
  for (const phase of ["pending_verification", "verifying", "implemented"]) {
    if (phase === "verifying") delivery = await f.content.beginDelivery(f.project.id, delivery.id, f.qa, { revision: delivery.revision });
    if (phase === "implemented") await f.review(delivery, "accepted");
    const before = await f.content.readIssue(f.project.id, f.issues[0].id, f.actor);
    assert.equal(before.status, phase);
    await sessions.send(task.runKey, "Check delivered code without changing verification");
    await sessions.events.drain();
    const after = await f.content.readIssue(f.project.id, f.issues[0].id, f.actor);
    assert.equal(after.revision, before.revision);
    assert.equal(after.processing?.handlerId, before.processing?.handlerId);
    await assert.rejects(sessions.deleteSession(task.runKey, { confirm: true, force: true, confirmBranch: (await sessions.store.read(task.runKey)).worktree.branch }), /执行|本轮/);
    const actions = await new WorkbenchServices(f.database, f.projects, { workspaces: f.workspaces }).actions(f.actor);
    assert.ok(actions.items.some(item => item.taskId === task.id && item.bucket === "doing"));
    await f.end();
  }
  assert.equal((await f.development.read(f.project.id, task.id, f.actor)).task.status, "completed");
  assert.equal(await f.database.client.workflowExecutionEvent.count({ where: { status: "blocked" } }), 0);
});

test("permanent deletion during verification retains business records and permits automatic completion", async t => {
  const f = await fixture(t), delivery = await f.submit();
  const state = await f.sessions.store.read(f.task.runKey);
  await f.sessions.deleteSession(f.task.runKey, { confirm: true, force: true, confirmBranch: state.worktree.branch });
  assert.equal(fs.existsSync(state.worktree.path), false);
  assert.equal(await f.sessions.store.hasRun(f.task.runKey), false);
  const task = (await f.development.read(f.project.id, f.task.id, f.actor)).task;
  assert.equal(task.status, "started"); assert.equal(task.canOpenSession, false); assert.equal(task.canArchive, false);
  assert.equal(task.execution.status, "completed"); assert.equal(task.sessionDeleted, true);
  assert.equal(await f.database.client.issueDevelopmentClaim.count({ where: { taskId: task.id } }), 1);
  const hidden = (await f.development.read(f.project.id, f.task.id, f.qa)).task;
  assert.equal(hidden.sessionDeleted, false); assert.equal(hidden.workspaceId, null); assert.equal(hidden.execution, null);
  await f.review(delivery, "accepted");
  assert.equal((await f.development.read(f.project.id, f.task.id, f.actor)).task.status, "completed");
  assert.equal(await f.database.client.projectDeliverable.count(), 1);
});

for (const removeSession of [false, true]) test(`returned work creates one linked replacement after ${removeSession ? "session" : "worktree"} deletion`, async t => {
  const f = await fixture(t, 2), first = await f.submit(), pending = await f.submit(f.issues[1]);
  const state = await f.sessions.store.read(f.task.runKey);
  if (removeSession) await f.sessions.deleteSession(f.task.runKey, { confirm: true, force: true, confirmBranch: state.worktree.branch });
  else {
    const status = await f.sessions.git.read(f.task.runKey);
    await f.sessions.git.remove(f.task.runKey, { expectedHead: status.head, statusToken: status.statusToken, confirmBranch: state.worktree.branch, discardChanges: true });
  }
  const returned = await f.review(first, "returned");
  const task = (await f.development.read(f.project.id, f.task.id, f.actor)).task;
  assert.equal(task.canRework, true);
  assert.equal((await f.content.readDeliverable(f.project.id, returned.id, f.actor)).developmentTask.canRework, true);
  assert.equal((await f.content.readDeliverable(f.project.id, returned.id, f.qa)).developmentTask, null);
  const input = { requestId: randomUUID(), revision: task.revision, deliveries: task.reworkDeliveries };
  await assert.rejects(f.development.rework(f.project.id, task.id, f.qa, input), { statusCode: 403 });
  await assert.rejects(f.development.rework(f.project.id, task.id, f.actor, { ...input, deliveries: [{ id: first.id, revision: 1 }] }), { statusCode: 409 });
  const startedCount = f.client.calls.filter(call => call.method === "turn/start").length;
  const replacement = (await f.development.rework(f.project.id, task.id, f.actor, input)).task;
  assert.equal(replacement.status, "planned"); assert.equal(replacement.reworkOfTaskId, task.id);
  assert.equal(f.client.calls.filter(call => call.method === "turn/start").length, startedCount);
  assert.equal((await f.development.rework(f.project.id, task.id, f.actor, input)).task.id, replacement.id);
  await assert.rejects(f.development.rework(f.project.id, task.id, f.actor, { ...input, requestId: randomUUID() }), { statusCode: 409 });
  assert.equal((await f.development.read(f.project.id, task.id, f.actor)).task.replacedByTaskId, replacement.id);
  assert.equal(await f.database.client.issueDevelopmentClaim.count({ where: { taskId: replacement.id } }), 2);
  assert.equal((await f.content.readIssue(f.project.id, f.issues[1].id, f.actor)).status, "pending_verification");
  const started = await f.start(replacement);
  const prompt = f.client.calls.filter(call => call.method === "turn/start").at(-1).params.input[0].text;
  assert.match(prompt, /Fix the edge case/); assert.match(prompt, /Original delivery evidence/); assert.match(prompt, /fixture-commit/);
  assert.equal((prompt.match(/--- 项目事项/g) || []).length, 1, "waiting verification scope is not dispatched");
  assert.notEqual(started.runKey, task.runKey);
  assert.notEqual((await f.sessions.store.read(started.runKey)).worktree.path, state.worktree.path);
  await f.end(started.runKey);
  const next = await f.submit(f.issues[0], started.id, { supersedesId: returned.id, previousRevision: returned.revision });
  assert.equal(next.supersedesId, first.id); assert.equal(next.taskId, started.id);
  await f.review(next, "accepted"); await f.review(pending, "accepted");
  assert.equal((await f.development.read(f.project.id, started.id, f.actor)).task.status, "completed");
  assert.equal((await f.development.read(f.project.id, task.id, f.actor)).task.status, "cancelled");
});
