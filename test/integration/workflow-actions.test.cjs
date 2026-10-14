const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { WorkbenchServices } = require("../../src/application/workbench-services.cjs");
const { AttentionServices } = require("../../src/application/attention-services.cjs");
const { SystemWorkflowServices } = require("../../src/application/system-workflow-services.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(p => p.scope === "project").map(p => p.id);
  const department = await database.client.department.create({ data: { name: "Workflow team", permissions } });
  const users = {};
  for (const name of ["owner", "dev", "qa", "watcher", "admin"]) users[name] = await database.client.user.create({ data: { username: name, displayName: name, passwordHash: "unused", ...(name === "admin" ? { role: "admin" } : { departmentId: department.id }) } });
  const project = await database.client.project.create({ data: { name: "Workflow", directoryName: "workflow", directoryKey: "workflow", remoteUrl: "https://example.test/workflow.git", ownerUserId: users.owner.id } });
  for (const user of Object.values(users).filter(user => user.role !== "admin")) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions } });
  const projects = new ProjectServices(database), content = new ProjectContentServices(database, projects);
  const development = new ProjectDevelopmentServices(database, projects, { get: () => assert.fail("Planning must not start an Agent") });
  const workbench = new WorkbenchServices(database, projects);
  const accounts = new AccountServices(database); t.after(() => accounts.close());
  const workflows = new SystemWorkflowServices(database, accounts, projects);
  const create = (extra = {}) => content.createIssue(project.id, users.owner, { type: "requirement", title: "Shared issue", qaOwnerId: users.qa.id, acceptanceOwnerId: users.owner.id, watcherIds: [users.watcher.id], ...extra });
  return { database, project, projects, content, development, workbench, workflows, permissions, create, ...users };
}

async function publish(f, definition) {
  let { workflow } = await f.workflows.readWorkflow("requirement", f.admin);
  ({ workflow } = await f.workflows.saveWorkflow("requirement", f.admin, { revision: workflow.revision, definition }));
  await f.workflows.saveWorkflow("requirement", f.admin, { revision: workflow.revision }, true);
}
const node = (id, kind, handler, category) => ({ id, name: id, kind, handler, category, allowDevelopment: kind !== "completed" });
const edge = (id, from, to, permission) => ({ id, from, to, name: id, permission, requiresReason: false });
function grant(f, user, permissions) {
  return f.database.client.projectMember.update({ where: { projectId_userId: { projectId: f.project.id, userId: user.id } }, data: { permissions } });
}

for (const [category, permission, readyBucket, activeBucket] of [["work", "issue.accept", "todo", "doing"], ["verification", "issue.transition", "verify", "verify"]]) {
  test(`workflow ${category} handlers enter, start and complete using configured ${permission}`, async t => {
    const f = await fixture(t);
    await publish(f, { nodes: [node("plan", "initial", "businessOwner", "planning"), node("review", "normal", "qaOwner", category), node("done", "completed", "businessOwner", "work")], transitions: [edge("submit", "plan", "review", "issue.transition"), edge("accept", "review", "done", permission)] });
    await grant(f, f.qa, ["project.view", "issue.view", permission]);
    let issue = await f.create();
    issue = await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, transitionId: "submit" });
    assert.deepEqual(issue.processing.startPermissions, [permission]);
    assert.equal((await f.workbench.actions(f.owner)).total, 0);
    assert.deepEqual((await f.workbench.actions(f.qa)).items.map(item => [item.issueId, item.bucket]), [[issue.id, readyBucket]]);
    issue = await f.content.startIssueStep(f.project.id, issue.id, f.qa, { revision: issue.revision, actionRevision: issue.processing.revision });
    assert.equal((await f.workbench.actions(f.qa)).items[0].bucket, activeBucket);
    await f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "accept" });
    assert.equal((await f.workbench.actions(f.qa)).total, 0);
  });
}

test("one configured permission permits starting while each transition still requires its own permission", async t => {
  const f = await fixture(t);
  await publish(f, { nodes: [node("plan", "initial", "businessOwner", "planning"), node("review", "normal", "qaOwner", "work"), node("done", "completed", "businessOwner", "work")], transitions: [edge("submit", "plan", "review", "issue.transition"), edge("return", "review", "plan", "issue.transition"), edge("accept", "review", "done", "issue.accept")] });
  await grant(f, f.qa, ["project.view", "issue.view", "issue.accept"]);
  let issue = await f.create();
  issue = await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, transitionId: "submit" });
  assert.deepEqual(issue.processing.startPermissions, ["issue.transition", "issue.accept"]);
  issue = await f.content.startIssueStep(f.project.id, issue.id, f.qa, { revision: issue.revision, actionRevision: issue.processing.revision });
  await assert.rejects(f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "return" }), { statusCode: 403 });
  assert.equal((await f.content.readIssue(f.project.id, issue.id, f.qa)).status, "review");
  await grant(f, f.qa, ["project.view", "issue.view"]);
  assert.equal((await f.workbench.actions(f.qa)).total, 0);
  assert.equal((await f.workbench.actions(f.owner)).items[0].label, "分派处理人");
  await assert.rejects(f.content.startIssueStep(f.project.id, issue.id, f.qa, { revision: issue.revision, actionRevision: issue.processing.revision }), { statusCode: 403 });
  await grant(f, f.qa, ["project.view", "issue.view", "issue.transition"]);
  assert.equal((await f.workbench.actions(f.owner)).total, 0);
  assert.equal((await f.workbench.actions(f.qa)).total, 1);
  await f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "return" });
});

test("development deduplication keeps another handler's step and merges only the same person's task", async t => {
  const f = await fixture(t);
  await publish(f, { nodes: [node("review", "initial", "businessOwner", "development"), node("done", "completed", "businessOwner", "work")], transitions: [edge("done", "review", "done", "issue.transition")] });
  const issue = await f.create();
  const task = (await f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: [issue.id] })).tasks[0];
  assert.equal((await f.content.readIssue(f.project.id, issue.id, f.owner)).processing.handlerId, f.owner.id);
  assert.deepEqual((await f.workbench.actions(f.owner)).items.map(item => [item.kind, item.issueId]), [["issue", issue.id]]);
  assert.deepEqual((await f.workbench.actions(f.dev)).items.map(item => [item.kind, item.taskId]), [["task", task.id]]);
  const attention = new AttentionServices(f.database, { projects: f.projects });
  assert.equal((await attention.list(f.owner)).items[0].issueId, issue.id);
  await f.development.update(f.project.id, task.id, f.owner, { revision: task.revision, executorId: f.owner.id });
  assert.deepEqual((await f.workbench.actions(f.owner)).items.map(item => [item.kind, item.taskId]), [["task", task.id]]);
  assert.equal((await f.workbench.actions(f.dev)).total, 0);
});

test("revoked development permissions yield a single coordinator action and planned reassignment restores the queue", async t => {
  const f = await fixture(t);
  let issue = await f.create();
  const task = (await f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: [issue.id] })).tasks[0];
  issue = await f.content.readIssue(f.project.id, issue.id, f.owner);
  await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, status: "developing" });
  const attention = new AttentionServices(f.database, { projects: f.projects });
  for (const revoked of [["session.start"], ["issue.view"], ["session.start", "issue.transition"]]) {
    await grant(f, f.dev, f.permissions.filter(p => !revoked.includes(p)));
    assert.equal((await f.workbench.actions(f.dev)).total, 0);
    const result = await f.workbench.actions(f.owner);
    assert.deepEqual(result.items.map(item => [item.kind, item.taskId, item.label]), [["task", task.id, "处理开发分派"]]);
    assert.deepEqual(result.counts, { todo: 1, doing: 0, verify: 0 });
    assert.equal((await attention.list(f.owner)).items[0].taskId, task.id);
    assert.equal((await f.workbench.actions(f.watcher)).total, 0);
    await assert.rejects(f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: [issue.id] }), { statusCode: 403 });
  }
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: f.project.id, userId: f.dev.id } }, data: { status: "removed" } });
  assert.equal((await f.workbench.actions(f.owner)).total, 1, "removed executor does not create duplicate issue and task recoveries");
  await f.development.update(f.project.id, task.id, f.owner, { revision: task.revision, executorId: f.qa.id });
  assert.equal((await f.workbench.actions(f.owner)).total, 0);
  assert.equal((await attention.list(f.owner)).total, 0);
  assert.equal((await f.workbench.actions(f.qa)).items[0].taskId, task.id);
  assert.equal((await f.content.readIssue(f.project.id, issue.id, f.owner)).processing.handlerId, f.qa.id);
  assert.equal(await f.database.client.run.count(), 0);
});

test("merged task recovery reaches each business owner without exposing a private execution or permitting reassignment after start", async t => {
  const f = await fixture(t);
  const issues = [await f.create(), await f.create({ businessOwnerId: f.qa.id })];
  const assigned = await f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: issues.map(issue => issue.id) });
  const { task } = await f.development.merge(f.project.id, f.dev, { requestId: randomUUID(), title: "Combined work", tasks: assigned.tasks.map(task => ({ id: task.id, revision: task.revision })) });
  for (const [index, actor] of [f.owner, f.qa].entries()) {
    const issue = await f.content.readIssue(f.project.id, issues[index].id, actor);
    await f.content.transitionIssue(f.project.id, issue.id, actor, { revision: issue.revision, status: "developing" });
  }
  const workspace = await f.database.client.workspace.create({ data: { ownerUserId: f.dev.id, name: "Private workspace" } });
  const stored = await f.database.client.developmentTask.findUniqueOrThrow({ where: { id: task.id } });
  await f.database.client.developmentTask.update({ where: { id: task.id }, data: { status: "started", workspaceId: workspace.id, runKey: "private-run", snapshot: { ...stored.snapshot, prompt: "private-prompt" } } });
  await f.database.client.run.create({ data: { path: "private-execution", workspaceId: workspace.id, runKey: "private-run", ownerUserId: f.dev.id, executionState: "running", data: { private: "private-messages" } } });
  await grant(f, f.dev, f.permissions.filter(p => !["session.start", "issue.transition"].includes(p)));
  const attention = new AttentionServices(f.database, { projects: f.projects });
  for (const actor of [f.owner, f.qa]) {
    const result = await f.workbench.actions(actor);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].taskId, task.id);
    assert.doesNotMatch(JSON.stringify([result, await attention.list(actor)]), /workspaceId|runKey|private-run|private-prompt|private-messages/);
  }
  assert.equal((await f.workbench.actions(f.watcher)).total, 0);
  await assert.rejects(f.development.update(f.project.id, task.id, f.owner, { revision: task.revision, executorId: f.qa.id }), { statusCode: 409 });
});

test("release archive filters both executor work and assignment recovery without losing recovery after restore", async t => {
  const f = await fixture(t);
  const release = await f.database.client.projectRelease.create({ data: { projectId: f.project.id, name: "Release" } });
  let issue = await f.create({ releaseId: release.id });
  const task = (await f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: [issue.id] })).tasks[0];
  issue = await f.content.readIssue(f.project.id, issue.id, f.owner);
  await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, status: "developing" });
  assert.equal((await f.workbench.actions(f.dev)).items[0].taskId, task.id);
  // Seed archived state directly to verify read filtering independently of the archive command's gates.
  await f.database.client.projectRelease.update({ where: { id: release.id }, data: { status: "archived" } });
  assert.equal((await f.workbench.actions(f.dev)).total, 0);
  await grant(f, f.dev, f.permissions.filter(p => p !== "session.start"));
  assert.equal((await f.workbench.actions(f.owner)).total, 0);
  await f.database.client.projectRelease.update({ where: { id: release.id }, data: { status: "active" } });
  assert.equal((await f.workbench.actions(f.owner)).items[0].taskId, task.id);
});

test("workflow responsibilities hand off actions, watchers and administrators never inherit them, and stale starts cannot act", async t => {
  const f = await fixture(t), { project, content, workbench, owner, dev, qa, watcher, admin } = f;
  let issue = await f.create();
  assert.equal(issue.reporterId, owner.id);
  assert.equal((await workbench.actions(owner, { bucket: "todo" })).total, 1);
  for (const user of [dev, qa, watcher, admin]) assert.equal((await workbench.actions(user)).total, 0);
  const original = issue;
  issue = await content.startIssueStep(project.id, issue.id, owner, { revision: issue.revision, actionRevision: issue.processing.revision });
  assert.equal((await workbench.actions(owner, { bucket: "doing" })).total, 1);
  await content.startIssueStep(project.id, issue.id, owner, { revision: original.revision, actionRevision: original.processing.revision });
  assert.equal(await f.database.client.issueHistory.count({ where: { action: "step.started" } }), 1, "retry does not duplicate step history");
  await assert.rejects(content.transitionIssue(project.id, issue.id, owner, { revision: issue.revision, status: "developing" }), /处理人/);
  const task = (await f.development.create(project.id, owner, { requestId: randomUUID(), executorId: dev.id, issueIds: [issue.id] })).tasks[0];
  issue = await content.readIssue(project.id, issue.id, owner);
  issue = await content.transitionIssue(project.id, issue.id, owner, { revision: issue.revision, status: "developing" });
  assert.equal(issue.processing.handlerId, dev.id);
  assert.equal((await workbench.actions(owner)).total, 0, "old business step ended on handoff");
  assert.deepEqual((await workbench.actions(dev)).items.map(item => [item.kind, item.bucket]), [["task", "todo"]], "planned development is not doing, and hides only its developer step");
  assert.equal(await f.database.client.run.count(), 0);
  await assert.rejects(content.startIssueStep(project.id, issue.id, owner, { revision: original.revision, actionRevision: original.processing.revision }), { statusCode: 403 });
  await f.development.finish(project.id, task.id, dev, { revision: task.revision }, "cancelled");
  assert.equal((await workbench.actions(owner)).items[0].label, "分派处理人", "cancelling a developer task sends missing assignment to the business owner");
  await f.development.create(project.id, owner, { requestId: randomUUID(), executorId: dev.id, issueIds: [issue.id] });
  issue = await content.readIssue(project.id, issue.id, dev);
  issue = await content.transitionIssue(project.id, issue.id, dev, { revision: issue.revision, status: "pending_verification" });
  assert.equal(issue.processing.handlerId, qa.id);
  assert.equal((await workbench.actions(qa, { bucket: "verify" })).total, 1);
  issue = await content.startIssueStep(project.id, issue.id, qa, { revision: issue.revision, actionRevision: issue.processing.revision });
  assert.equal((await workbench.actions(qa, { bucket: "verify" })).total, 1, "started verification remains in verification");
  assert.equal((await workbench.actions(qa, { bucket: "doing" })).total, 0);
  const oldQaStep = issue;
  issue = await content.updateIssue(project.id, issue.id, owner, { revision: issue.revision, qaOwnerId: watcher.id });
  assert.equal((await workbench.actions(qa)).total, 0);
  assert.equal((await workbench.actions(watcher, { bucket: "verify" })).total, 1, "watcher becomes actionable only after explicit assignment");
  await assert.rejects(content.startIssueStep(project.id, issue.id, qa, { revision: oldQaStep.revision, actionRevision: oldQaStep.processing.revision }), { statusCode: 403 });
  assert.equal(await f.database.client.workAction.count({ where: { issueId: issue.id, status: { in: ["ready", "active"] } } }), 1);
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: watcher.id } }, data: { permissions: ["project.view", "issue.view"] } });
  assert.equal((await workbench.actions(watcher)).total, 0);
  assert.equal((await workbench.actions(owner)).items[0].label, "分派处理人", "revoked handler is visible as a recovery action to the business owner");
});

test("delivery return, explicit reviewer and resubmission preserve history and produce the same notifications as workbench", async t => {
  const f = await fixture(t), { project, content, workbench, owner, dev, qa } = f;
  const issue = await f.create();
  await assert.rejects(content.addDeliverable(project.id, dev, { issueId: issue.id, body: "Result", reviewerId: "missing-user" }), /有效项目成员/);
  const delivery = await content.addDeliverable(project.id, dev, { issueId: issue.id, body: "Result", reviewerId: qa.id });
  assert.equal((await workbench.actions(owner)).items[0].kind, "issue", "delivery must not hide a different person's planning action");
  assert.deepEqual((await workbench.actions(qa)).items.map(item => [item.kind, item.bucket]), [["delivery", "verify"]]);
  await assert.rejects(content.beginDelivery(project.id, delivery.id, owner, { revision: 1 }), { statusCode: 403 });
  let current = await content.beginDelivery(project.id, delivery.id, qa, { revision: 1 });
  assert.equal((await workbench.actions(qa)).items[0].phase, "验证中");
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, owner, { revision: current.revision, status: "accepted", checkedItems: [0, 1, 2] }), { statusCode: 403 });
  current = await content.reviewDeliverable(project.id, delivery.id, qa, { revision: current.revision, status: "returned", checkedItems: [], reviewNote: "Missing test evidence" });
  assert.equal((await workbench.actions(qa)).total, 0);
  assert.equal((await workbench.actions(dev)).items[0].label, "修改并重新提交");
  const next = { issueId: issue.id, body: "Corrected with evidence", reviewerId: qa.id, supersedesId: delivery.id, previousRevision: current.revision };
  await assert.rejects(content.addDeliverable(project.id, owner, next), { statusCode: 403 });
  const results = await Promise.allSettled([content.addDeliverable(project.id, dev, next), content.addDeliverable(project.id, dev, next)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.statusCode, 409);
  assert.equal((await content.readDeliverable(project.id, delivery.id, dev)).delivery.reviewNote, "Missing test evidence");
  assert.equal((await workbench.actions(dev)).total, 0);
  const attention = new AttentionServices(f.database, { projects: f.projects });
  const page = await workbench.actions(qa, { bucket: "verify", limit: 1 });
  assert.equal(page.total, 1); assert.equal(page.counts.verify, 1);
  assert.equal((await attention.list(qa)).items[0].deliveryId, page.items[0].deliveryId);
  assert.equal((await attention.list(owner)).items[0].issueId, issue.id);
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: qa.id } }, data: { permissions: ["project.view", "issue.view"] } });
  assert.equal((await workbench.actions(qa)).total, 0);
  assert.ok((await workbench.actions(owner)).items.some(item => item.label === "重新指定验证人"));
  const reassigned = await content.reassignDelivery(project.id, page.items[0].deliveryId, owner, { revision: 1, reviewerId: f.watcher.id });
  assert.equal(reassigned.revision, 2);
  assert.equal(reassigned.verificationStartedAt, null);
  assert.equal((await workbench.actions(f.watcher)).items[0].deliveryId, reassigned.id);
  await assert.rejects(content.reviewDeliverable(project.id, reassigned.id, qa, { revision: 1, status: "accepted", checkedItems: [0, 1, 2] }), { statusCode: 403 });
});

test("published workflow fields and delivery gates apply atomically to both direct transitions and combined reviews", async t => {
  const f = await fixture(t), { project, content, workflows, owner, qa, admin } = f;
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  const definition = { nodes: [
    { id: "review", name: "QA", kind: "initial", allowDevelopment: false, handler: "qaOwner", category: "verification" },
    { id: "done", name: "Done", kind: "completed", allowDevelopment: false, handler: "businessOwner", category: "work" },
  ], transitions: [{ id: "accept", from: "review", to: "done", name: "Accept", permission: "issue.accept", requiresReason: false, requiredFields: ["acceptanceCriteria"], requireAcceptedDelivery: true }] };
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true);
  let issue = await f.create();
  assert.equal(issue.processing.handlerId, qa.id);
  await assert.rejects(content.transitionIssue(project.id, issue.id, qa, { transitionId: "accept", revision: issue.revision }), /验收标准/);
  const delivery = await content.addDeliverable(project.id, owner, { issueId: issue.id, body: "Result" });
  const review = { revision: 1, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i), transitionId: "accept", issueRevision: issue.revision };
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, qa, review), /验收标准/);
  assert.equal((await content.readDeliverable(project.id, delivery.id, qa)).delivery.status, "pending", "failed handoff rolls back the review too");
  issue = await content.updateIssue(project.id, issue.id, owner, { revision: issue.revision, acceptanceCriteria: "Expected result" });
  await assert.rejects(content.transitionIssue(project.id, issue.id, qa, { transitionId: "accept", revision: issue.revision }), /最新交付/);
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, qa, { ...review, status: "returned", reviewNote: "Fail", issueRevision: issue.revision }), /验收|一致/);
  assert.equal((await content.readDeliverable(project.id, delivery.id, qa)).delivery.status, "pending");
  await content.reviewDeliverable(project.id, delivery.id, qa, { ...review, issueRevision: issue.revision });
  assert.equal((await content.readIssue(project.id, issue.id, qa)).status, "done");
  assert.equal((await f.workbench.actions(qa)).total, 0);
  assert.equal(await f.database.client.run.count(), 0);
});

test("execution actions distinguish running, blocked, ended and unknown without exposing another executor", async t => {
  const f = await fixture(t), { database, project, projects, dev, owner } = f;
  const workspace = await database.client.workspace.create({ data: { ownerUserId: dev.id, name: "Private development" } });
  await database.client.developmentSpace.create({ data: { projectId: project.id, userId: dev.id, workspaceId: workspace.id, status: "ready" } });
  const task = await database.client.developmentTask.create({ data: { projectId: project.id, executorId: dev.id, creatorId: owner.id, requestId: randomUUID(), workspaceId: workspace.id, runKey: "run", status: "started", snapshot: { title: "Implementation", issues: [] } } });
  const run = await database.client.run.create({ data: { path: "fixture-run", workspaceId: workspace.id, runKey: "run", ownerUserId: dev.id, executionState: "running", data: { private: "secret content" } } });
  let requests = [];
  const workbench = new WorkbenchServices(database, projects, { workspaces: { pendingRequests: async () => [{ key: "run", requests }] } });
  assert.equal((await workbench.actions(dev)).items[0].bucket, "doing");
  requests = [{ id: "approve", turnId: "turn-1", blocking: true }];
  assert.equal((await workbench.actions(dev)).items[0].bucket, "todo");
  assert.equal((await workbench.actions(owner)).total, 0);
  requests = [{ id: "notice", blocking: false }];
  assert.equal((await workbench.actions(dev)).items[0].bucket, "doing");
  requests = [];
  for (const [status, label] of [["completed", "整理成果"], ["failed", "整理成果"], ["unknown", "核对原执行"]]) {
    await database.client.run.update({ where: { path: run.path }, data: { executionState: status } });
    const result = await workbench.actions(dev);
    assert.equal(result.items[0].label, label); assert.equal(result.items[0].bucket, "todo");
    assert.doesNotMatch(JSON.stringify(result), /secret content/);
  }
  await database.client.developmentTask.update({ where: { id: task.id }, data: { status: "completed" } });
  requests = [{ id: "stale", blocking: true }];
  assert.equal((await workbench.actions(dev)).total, 0, "closed development cannot reappear as a legacy session action");
});
