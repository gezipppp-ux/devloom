const { reviewWorkflow, installReviewWorkflow, recordDevelopmentTurn } = require("../support/workflow-fixture.cjs");
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
  const create = (extra = {}) => content.createIssue(project.id, users.owner, { ...{ businessOwnerId: users.owner.id, qaOwnerId: users.owner.id, acceptanceOwnerId: users.owner.id }, type: "requirement", title: "Shared issue", qaOwnerId: users.qa.id, acceptanceOwnerId: users.owner.id, watcherIds: [users.watcher.id], ...extra });
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

for (const [category, permission, readyBucket] of [["work", "issue.accept", "doing"], ["verification", "issue.transition", "verify"]]) {
  test(`workflow ${category} handlers enter active nodes and complete using configured ${permission}`, async t => {
    const f = await fixture(t);
    await publish(f, { nodes: [node("plan", "initial", "businessOwner", "planning"), { ...node("review", "normal", "qaOwner", category), active: true }, node("done", "completed", "businessOwner", "work")], transitions: [edge("submit", "plan", "review", "issue.transition"), edge("accept", "review", "done", permission)] });
    await grant(f, f.qa, ["project.view", "issue.view", permission]);
    let issue = await f.create();
    issue = await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, transitionId: "submit" });
    assert.equal(issue.processing.status, "active");
    assert.equal((await f.workbench.actions(f.owner)).total, 0);
    assert.deepEqual((await f.workbench.actions(f.qa)).items.map(item => [item.issueId, item.bucket]), [[issue.id, readyBucket]]);

    await f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "accept" });
    assert.equal((await f.workbench.actions(f.qa)).total, 0);
  });
}

test("each configured transition requires its own permission and revoked handlers get recovery", async t => {
  const f = await fixture(t);
  await publish(f, { nodes: [node("plan", "initial", "businessOwner", "planning"), node("review", "normal", "qaOwner", "work"), node("done", "completed", "businessOwner", "work")], transitions: [edge("submit", "plan", "review", "issue.transition"), edge("return", "review", "plan", "issue.transition"), edge("accept", "review", "done", "issue.accept")] });
  await grant(f, f.qa, ["project.view", "issue.view", "issue.accept"]);
  let issue = await f.create();
  issue = await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, transitionId: "submit" });
  assert.equal((await f.content.readIssue(f.project.id, issue.id, f.qa)).availableTransitions.length, 1);
  await assert.rejects(f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "return" }), { statusCode: 403 });
  assert.equal((await f.content.readIssue(f.project.id, issue.id, f.qa)).status, "review");
  await grant(f, f.qa, ["project.view", "issue.view"]);
  assert.equal((await f.workbench.actions(f.qa)).total, 0);
  assert.equal((await f.workbench.actions(f.owner)).items[0].label, "分派处理人");
  await assert.rejects(f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "accept" }), { statusCode: 403 });
  await grant(f, f.qa, ["project.view", "issue.view", "issue.transition"]);
  assert.equal((await f.workbench.actions(f.owner)).total, 0);
  assert.equal((await f.workbench.actions(f.qa)).total, 1);
  await f.content.transitionIssue(f.project.id, issue.id, f.qa, { revision: issue.revision, transitionId: "return" });
});

test("custom planning handoff preserves a distinct handler and deduplicates only the executor", async t => {
  const f = await fixture(t);
  await publish(f, { nodes: [{ ...node("plan", "initial", "businessOwner", "planning"), allowAssignment: true }, node("review", "normal", "businessOwner", "development"), node("done", "completed", "businessOwner", "work")], transitions: [{ ...edge("assign", "plan", "review", "issue.transition"), trigger: "development.assigned", actor: "assigner", assignment: "role" }, edge("done", "review", "done", "issue.transition")] });
  const issue = await f.create();
  const task = (await f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: [issue.id] })).tasks[0];
  assert.equal((await f.content.readIssue(f.project.id, issue.id, f.owner)).processing.handlerId, f.owner.id);
  assert.deepEqual((await f.workbench.actions(f.owner)).items.map(item => [item.kind, item.issueId]), [["issue", issue.id]]);
  assert.deepEqual((await f.workbench.actions(f.dev)).items.map(item => [item.kind, item.taskId]), [["task", task.id]]);
  await f.development.update(f.project.id, task.id, f.owner, { revision: task.revision, executorId: f.owner.id });
  assert.deepEqual((await f.workbench.actions(f.owner)).items.map(item => [item.kind, item.taskId]), [["task", task.id]]);
  assert.equal((await f.workbench.actions(f.dev)).total, 0);
});

test("revoked development permissions yield a single coordinator action and planned reassignment restores the queue", async t => {
  const f = await fixture(t);
  let issue = await f.create();
  const task = (await f.development.create(f.project.id, f.owner, { requestId: randomUUID(), executorId: f.dev.id, issueIds: [issue.id] })).tasks[0];
  issue = await f.content.readIssue(f.project.id, issue.id, f.owner);
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
  assert.equal((await f.workbench.actions(f.dev)).items[0].taskId, task.id);
  // Seed archived state directly to verify read filtering independently of the archive command's gates.
  await f.database.client.projectRelease.update({ where: { id: release.id }, data: { status: "archived" } });
  assert.equal((await f.workbench.actions(f.dev)).total, 0);
  await grant(f, f.dev, f.permissions.filter(p => p !== "session.start"));
  assert.equal((await f.workbench.actions(f.owner)).total, 0);
  await f.database.client.projectRelease.update({ where: { id: release.id }, data: { status: "active" } });
  assert.equal((await f.workbench.actions(f.owner)).items[0].taskId, task.id);
});

test("responsibilities hand off on assignment and delivery; stale owners and watchers cannot act", async t => {
  const f = await fixture(t), { project, content, workbench, owner, dev, qa, watcher, admin } = f;
  const original = await f.create();
  assert.equal(original.reporterId, owner.id);
  assert.equal((await workbench.actions(owner)).total, 1);
  for (const user of [dev, qa, watcher, admin]) assert.equal((await workbench.actions(user)).total, 0);
  const task = (await f.development.create(project.id, owner, { requestId: randomUUID(), executorId: dev.id, issueIds: [original.id] })).tasks[0];
  let issue = await content.readIssue(project.id, original.id, dev);
  assert.equal(issue.processing.handlerId, dev.id);
  assert.equal(issue.status, "ready");
  assert.equal((await workbench.actions(owner)).total, 0);
  assert.deepEqual((await workbench.actions(dev)).items.map(item => [item.kind, item.bucket]), [["task", "todo"]]);
  assert.equal(await f.database.client.run.count(), 0);
  await assert.rejects(content.transitionIssue(project.id, issue.id, owner, { revision: original.revision, status: "rejected", reason: "stale" }), { statusCode: 409 });
  await recordDevelopmentTurn(f.database, f.development, project.id, task.id, dev);
  const delivery = await content.addDeliverable(project.id, dev, { issueId: issue.id, taskId: task.id, body: "Evidence", reviewerId: qa.id });
  assert.equal((await workbench.actions(qa, { bucket: "verify" })).total, 1);
  const current = await content.beginDelivery(project.id, delivery.id, qa, { revision: delivery.revision });
  assert.equal((await workbench.actions(qa, { bucket: "doing" })).total, 0);
  await content.reassignDelivery(project.id, delivery.id, owner, { revision: current.revision, reviewerId: watcher.id });
  assert.equal((await workbench.actions(qa)).total, 0);
  assert.equal((await workbench.actions(watcher, { bucket: "verify" })).total, 1);
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, qa, { revision: current.revision, status: "accepted", checkedItems: [0, 1, 2] }), { statusCode: 403 });
  assert.equal(await f.database.client.workAction.count({ where: { issueId: issue.id, status: { in: ["ready", "active"] } } }), 1);
  await grant(f, watcher, ["project.view", "issue.view"]);
  assert.equal((await workbench.actions(watcher)).total, 0);
  assert.ok((await workbench.actions(owner)).items.some(item => item.label === "重新指定验证人"));
});

test("verification steps survive inaccessible deliveries and return after delivery review", async t => {
  const f = await fixture(t);
  const definition = reviewWorkflow();
  definition.nodes.find(node => node.id === "draft").handler = "qaOwner";
  await installReviewWorkflow(f.database, definition);
  const issue = await f.create();
  const delivery = await f.content.addDeliverable(f.project.id, f.qa, { issueId: issue.id, body: "Result", reviewerId: f.qa.id });
  const attention = new AttentionServices(f.database, { projects: f.projects });
  assert.deepEqual((await f.workbench.actions(f.qa)).items.map(item => item.kind), ["delivery"]);
  for (const revoked of ["deliverable.review", "collaboration.view"]) {
    await grant(f, f.qa, f.permissions.filter(p => p !== revoked));
    const page = await f.workbench.actions(f.qa);
    assert.deepEqual(page.items.map(item => [item.kind, item.issueId]), [["issue", issue.id]]);
    assert.equal(page.counts.verify, 1);
    assert.equal((await attention.list(f.qa)).items[0].issueId, issue.id);
  }
  await grant(f, f.qa, f.permissions);
  assert.deepEqual((await f.workbench.actions(f.qa)).items.map(item => item.kind), ["delivery"]);
  await f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: delivery.revision, status: "returned", checkedItems: [], reviewNote: "Revise" });
  assert.deepEqual((await f.workbench.actions(f.qa)).items.map(item => [item.kind, item.issueId]), [["delivery", issue.id]]);
});

test("delivery return, explicit reviewer and resubmission preserve history and produce the same notifications as workbench", async t => {
  const f = await fixture(t), { project, content, workbench, owner, dev, qa } = f;
  await installReviewWorkflow(f.database);
  const issue = await f.create({ businessOwnerId: dev.id });
  const separateIssue = await f.create();
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
  assert.equal((await attention.list(owner)).items[0].issueId, separateIssue.id);
  await content.updateIssue(project.id, issue.id, owner, { revision: (await content.readIssue(project.id, issue.id, owner)).revision, businessOwnerId: owner.id });
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: qa.id } }, data: { permissions: ["project.view", "issue.view"] } });
  assert.equal((await workbench.actions(qa)).total, 0);
  assert.ok((await workbench.actions(owner)).items.some(item => item.label === "重新指定验证人"));
  const reassigned = await content.reassignDelivery(project.id, page.items[0].deliveryId, owner, { revision: 1, reviewerId: f.watcher.id });
  assert.equal(reassigned.revision, 2);
  assert.equal(reassigned.verificationStartedAt, null);
  assert.equal((await workbench.actions(f.watcher)).items[0].deliveryId, reassigned.id);
  await assert.rejects(content.reviewDeliverable(project.id, reassigned.id, qa, { revision: 1, status: "accepted", checkedItems: [0, 1, 2] }), { statusCode: 403 });
});

test("published workflow fields and delivery gates roll back a review with an invalid handoff", async t => {
  const f = await fixture(t), { project, content, owner, qa } = f;
  const definition = reviewWorkflow();
  for (const edge of definition.transitions.filter(edge => edge.trigger === "verification.accepted")) Object.assign(edge, { requiredFields: ["acceptanceCriteria"], requireAcceptedDelivery: true });
  await publish(f, definition);
  let issue = await f.create();
  const delivery = await content.addDeliverable(project.id, owner, { issueId: issue.id, body: "Result", reviewerId: qa.id });
  const review = { revision: 1, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i) };
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, qa, review), /验收标准/);
  assert.equal((await content.readDeliverable(project.id, delivery.id, qa)).delivery.status, "pending");
  issue = await content.readIssue(project.id, issue.id, owner);
  await content.updateIssue(project.id, issue.id, owner, { revision: issue.revision, acceptanceCriteria: ["Expected result"] });
  await content.reviewDeliverable(project.id, delivery.id, qa, review);
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
