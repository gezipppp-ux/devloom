const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { installReviewWorkflow } = require("../support/workflow-fixture.cjs");
const { recommendedWorkflow } = require("../../src/domain/recommended-workflow.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { WorkbenchServices } = require("../../src/application/workbench-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

async function fixture(t, { count = 1, type = "requirement" } = {}) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(permission => permission.scope === "project").map(permission => permission.id);
  const department = await database.client.department.create({ data: { name: "Delivery team", permissions } });
  const users = {};
  for (const name of ["product", "dev", "qa", "other"]) users[name] = await database.client.user.create({ data: { username: name, displayName: name, departmentId: department.id, passwordHash: "unused" } });
  const project = await database.client.project.create({ data: { name: "Delivery", directoryName: "delivery", directoryKey: "delivery", remoteUrl: "https://example.test/repo.git", ownerUserId: users.product.id } });
  for (const [name, user] of Object.entries(users)) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions: name === "product" ? permissions.filter(permission => !permission.startsWith("session.")) : permissions } });
  const projects = new ProjectServices(database), content = new ProjectContentServices(database, projects);
  const development = new ProjectDevelopmentServices(database, projects, { get: () => assert.fail("Agent must not start") });
  const workbench = new WorkbenchServices(database, projects);
  const issues = [];
  for (let index = 0; index < count; index++) issues.push(await content.createIssue(project.id, users.product, { type, title: "Outcome " + index, description: "Configuration behavior", reproductionSteps: "Open the result", expectedResult: "Expected behavior", actualResult: "Original behavior", acceptanceCriteria: "The result can be verified.", ...(type === "bug" ? { acceptanceOwnerId: users.other.id } : {}) }));
  const publish = () => installReviewWorkflow(database, recommendedWorkflow(type), type);
  const upgrade = async (issue = issues[0]) => {
    const preview = await content.previewWorkflowUpgrade(project.id, issue.id, users.product);
    assert.equal(preview.available, true, preview.reason);
    const { issueRevision, actionRevision, targetVersionId, tasks } = preview;
    const input = { requestId: randomUUID(), issueRevision, actionRevision, targetVersionId, tasks, reason: "Use the reviewed delivery workflow" };
    return { issue: await content.upgradeIssueWorkflow(project.id, issue.id, users.product, input), input };
  };
  const read = (issue = issues[0], actor = users.product) => content.readIssue(project.id, issue.id, actor);
  const submit = (issue, actor, extra = {}) => content.addDeliverable(project.id, actor, { requestId: randomUUID(), issueId: issue.id, issueRevision: issue.revision, reviewerId: users.qa.id, body: "Completed work and verification evidence", ...extra });
  const review = (delivery, status = "accepted") => content.reviewDeliverable(project.id, delivery.id, users.qa, { revision: delivery.revision, status, checkedItems: status === "accepted" ? delivery.checklist.map((_, i) => i) : [], reviewNote: status === "returned" ? "Add the missing result" : "Verified" });
  return { database, project, projects, content, development, workbench, issues, publish, upgrade, read, submit, review, ...users };
}

test("unstarted existing work upgrades explicitly, submits, and settles without an Agent identity", async t => {
  const f = await fixture(t);
  const { tasks: [task] } = await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: [f.issues[0].id] });
  const before = await f.read();
  const snapshot = (await f.development.store.task(f.project.id, task.id)).snapshot;
  await f.publish();
  assert.equal((await f.read()).workflow.version, 1, "publication does not silently rebind existing issues");
  const { issue, input } = await f.upgrade();
  assert.equal(issue.status, "ready");
  assert.equal(issue.workflow.version, 2);
  assert.notEqual(issue.processing.id, before.processing.id);
  assert.deepEqual((await f.development.store.task(f.project.id, task.id)).snapshot, snapshot);
  await f.content.upgradeIssueWorkflow(f.project.id, issue.id, f.product, input);
  await assert.rejects(f.content.upgradeIssueWorkflow(f.project.id, issue.id, f.product, { ...input, reason: "Changed" }), { statusCode: 409 });
  assert.equal(await f.database.client.issueHistory.count({ where: { action: "workflow.upgraded" } }), 1);
  assert.equal((await f.read(issue, f.dev)).deliverySubmission.allowed, true);
  const requestId = randomUUID(), delivery = await f.submit(issue, f.dev, { taskId: task.id, requestId });
  assert.equal((await f.submit(issue, f.dev, { taskId: task.id, requestId })).id, delivery.id);
  assert.equal((await f.read()).status, "pending_verification");
  assert.equal((await f.development.read(f.project.id, task.id, f.dev)).task.canStart, false);
  const queue = await f.workbench.actions(f.dev, {});
  assert.equal(queue.items.some(item => item.taskId === task.id), false);
  await f.review(delivery);
  const completed = await f.development.store.task(f.project.id, task.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.runKey, null);
  assert.equal(completed.workspaceId, null);
  assert.equal(await f.database.client.issueDevelopmentClaim.count(), 0);
  assert.equal(await f.database.client.workflowExecutionEvent.count(), 0);
  assert.equal(await f.database.client.run.count(), 0);
});

test("manual outcomes return to their submitter and resubmit without development permissions", async t => {
  const f = await fixture(t); await f.publish();
  let { issue } = await f.upgrade();
  assert.equal(issue.deliverySubmission.allowed, true);
  let delivery = await f.submit(issue, f.product);
  delivery = await f.review(delivery, "returned");
  issue = await f.read();
  assert.equal(issue.status, "rework");
  assert.equal(issue.processing.handlerId, f.product.id);
  assert.equal(issue.developerId, null);
  const next = await f.submit(issue, f.product, { supersedesId: delivery.id, previousRevision: delivery.revision });
  assert.equal(next.supersedesId, delivery.id);
  await f.review(next);
  assert.equal((await f.read()).status, "implemented");
  assert.equal(await f.database.client.developmentTask.count(), 0);
  assert.equal(await f.database.client.workspace.count(), 0);
});

test("existing outcomes retain an unstarted task through return and resubmission", async t => {
  const f = await fixture(t);
  const { tasks: [task] } = await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: [f.issues[0].id] });
  await f.publish(); const { issue } = await f.upgrade();
  const returned = await f.review(await f.submit(issue, f.dev, { taskId: task.id }), "returned");
  const current = await f.read();
  assert.equal(current.processing.handlerId, f.dev.id);
  assert.equal((await f.development.store.task(f.project.id, task.id)).status, "planned");
  const next = await f.submit(current, f.dev, { taskId: task.id, supersedesId: returned.id, previousRevision: returned.revision });
  await f.review(next);
  assert.equal((await f.development.store.task(f.project.id, task.id)).status, "completed");
});

test("manual rework can explicitly acquire development and retain the original delivery chain", async t => {
  const f = await fixture(t); await f.publish();
  const { issue } = await f.upgrade();
  const returned = await f.review(await f.submit(issue, f.product), "returned");
  const { tasks: [task] } = await f.development.create(f.project.id, f.product, { requestId: randomUUID(), issueIds: [issue.id], executorId: f.other.id });
  assert.equal((await f.read()).status, "ready");
  assert.equal((await f.content.readDeliverable(f.project.id, returned.id, f.other)).canResubmit, true);
  const next = await f.submit(await f.read(), f.other, { taskId: task.id, supersedesId: returned.id, previousRevision: returned.revision });
  assert.equal(next.supersedesId, returned.id);
  await f.review(next);
});

test("version switching rejects stale task revisions and uncertain execution identities", async t => {
  const f = await fixture(t);
  const { tasks: [task] } = await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: [f.issues[0].id] });
  await f.publish();
  const preview = await f.content.previewWorkflowUpgrade(f.project.id, f.issues[0].id, f.product);
  const { issueRevision, actionRevision, targetVersionId, tasks } = preview;
  await f.database.client.developmentTask.update({ where: { id: task.id }, data: { revision: { increment: 1 } } });
  await assert.rejects(f.content.upgradeIssueWorkflow(f.project.id, f.issues[0].id, f.product, { requestId: randomUUID(), issueRevision, actionRevision, targetVersionId, tasks, reason: "Upgrade" }), { statusCode: 409 });
  assert.equal((await f.read()).workflow.version, 1);
  await f.database.client.developmentTask.update({ where: { id: task.id }, data: { runKey: "uncertain", status: "unknown" } });
  assert.equal((await f.content.previewWorkflowUpgrade(f.project.id, f.issues[0].id, f.product)).available, false);
  assert.equal((await f.read()).workflow.version, 1);
  await assert.rejects(f.content.previewWorkflowUpgrade(f.project.id, f.issues[0].id, { id: "missing" }), { statusCode: 401 });
});

test("partial delivery does not settle a merged task and delivery source cannot omit its claim", async t => {
  const f = await fixture(t, { count: 2 });
  const { tasks } = await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: f.issues.map(issue => issue.id) });
  const { task } = await f.development.merge(f.project.id, f.dev, { requestId: randomUUID(), title: "Combined", tasks: tasks.map(({ id, revision }) => ({ id, revision })) });
  await f.publish();
  for (const issue of f.issues) await f.upgrade(issue);
  await assert.rejects(f.submit(await f.read(), f.dev), { statusCode: 409 });
  const first = await f.submit(await f.read(), f.dev, { taskId: task.id });
  const pending = (await f.development.read(f.project.id, task.id, f.dev)).task;
  assert.equal(pending.canEdit, false);
  assert.equal(pending.canMerge, false);
  await assert.rejects(f.development.update(f.project.id, task.id, f.dev, { revision: pending.revision, title: "Changed" }), { statusCode: 409 });
  await f.review(first);
  assert.equal((await f.development.store.task(f.project.id, task.id)).status, "planned");
  const second = await f.submit(await f.read(f.issues[1]), f.dev, { taskId: task.id });
  await f.review(second);
  assert.equal((await f.development.store.task(f.project.id, task.id)).status, "completed");
});

test("workflow adoption checks node compatibility, project permissions, and delivery history", async t => {
  const f = await fixture(t);
  const incompatible = recommendedWorkflow("requirement");
  incompatible.nodes.find(node => node.id === "planned").category = "work";
  await installReviewWorkflow(f.database, incompatible);
  assert.equal((await f.content.previewWorkflowUpgrade(f.project.id, f.issues[0].id, f.product)).available, false);
  await f.publish(); const { issue } = await f.upgrade();
  await f.submit(issue, f.product);
  await f.publish();
  assert.equal((await f.content.previewWorkflowUpgrade(f.project.id, issue.id, f.product)).available, false);
  await f.database.client.projectMember.update({ where: { projectId_userId: { projectId: f.project.id, userId: f.other.id } }, data: { permissions: ["issue.view"] } });
  await assert.rejects(f.content.previewWorkflowUpgrade(f.project.id, issue.id, f.other), { statusCode: 403 });
  await f.database.client.project.update({ where: { id: f.project.id }, data: { status: "archived" } });
  await assert.rejects(f.content.previewWorkflowUpgrade(f.project.id, issue.id, f.product), { statusCode: 409 });
});

async function fakeDevelopmentSpace(f, validate = async selection => selection) {
  const workspace = await f.database.client.workspace.create({ data: { ownerUserId: f.dev.id, name: "Isolated fake workspace" } });
  const gitAccount = await f.database.client.gitAccount.create({ data: { userId: f.dev.id, name: "Fixture", authType: "http", host: "example.test", remoteUrl: f.project.remoteUrl, credentials: "unused" } });
  await f.database.client.developmentSpace.create({ data: { projectId: f.project.id, userId: f.dev.id, workspaceId: workspace.id, gitAccountId: gitAccount.id, status: "ready" } });
  const starts = [];
  f.development.workspaces = { async get() { return {
    sessions: { validateStartSelection: validate, async start(input) {
      starts.push(input);
      return { key: (await f.development.store.task(f.project.id, input.requestId)).runKey };
    } }, channels: { get: () => ({ async resolve() {} }) },
  }; } };
  return starts;
}

test("a merged task starts only remaining development scope and preserves its complete source snapshot", async t => {
  const f = await fixture(t, { count: 2 });
  const { tasks } = await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: f.issues.map(issue => issue.id) });
  const { task } = await f.development.merge(f.project.id, f.dev, { requestId: randomUUID(), title: "Combined partial work", tasks: tasks.map(({ id, revision }) => ({ id, revision })) });
  await f.publish(); for (const issue of f.issues) await f.upgrade(issue);
  await f.submit(await f.read(), f.dev, { taskId: task.id });
  const starts = await fakeDevelopmentSpace(f);
  await f.development.start(f.project.id, task.id, f.dev, { requestId: randomUUID(), revision: task.revision, baseBranch: "main" });
  assert.equal(starts.length, 1);
  assert.ok(starts[0].content.includes(f.issues[1].title));
  assert.ok(!starts[0].content.includes(f.issues[0].title));
  const current = await f.development.store.task(f.project.id, task.id);
  assert.equal(current.snapshot.issues.length, 2);
  assert.deepEqual(current.snapshot.workflowIntent.steps.map(step => step.issueId), [f.issues[1].id]);
  assert.equal((await f.read()).status, "pending_verification");
  assert.equal(await f.database.client.workflowExecutionEvent.count(), 0, "fake acceptance is not a real Agent turn");
});

test("delivery during startup preparation prevents stale dispatch without creating a run identity", async t => {
  const f = await fixture(t);
  const { tasks: [task] } = await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: [f.issues[0].id] });
  await f.publish(); await f.upgrade();
  const starts = await fakeDevelopmentSpace(f, async selection => {
    await f.submit(await f.read(), f.dev, { taskId: task.id });
    return selection;
  });
  await assert.rejects(f.development.start(f.project.id, task.id, f.dev, { requestId: randomUUID(), revision: task.revision, baseBranch: "main" }), { statusCode: 409 });
  assert.equal(starts.length, 0);
  const current = await f.development.store.task(f.project.id, task.id);
  assert.equal(current.runKey, null);
  assert.equal(current.workspaceId, null);
  assert.equal(current.snapshot.startRequest, undefined);
});

test("manual Bug results retain business acceptance and return to the delivery author", async t => {
  const f = await fixture(t, { type: "bug" }); await f.publish();
  const { issue } = await f.upgrade();
  const accepted = await f.review(await f.submit(issue, f.product));
  let current = await f.read();
  assert.equal(current.status, "verified");
  const returnedEdge = current.workflowActions.find(edge => edge.status === "rework");
  assert.equal(returnedEdge.nextHandlerId, f.product.id, "handoff preview names the delivery author");
  current = await f.content.transitionIssue(f.project.id, issue.id, f.other, { revision: current.revision, transitionId: returnedEdge.id, reason: "Adjust the manual result" });
  assert.equal(current.processing.handlerId, f.product.id);
  const next = await f.submit(current, f.product);
  await f.review(next);
  current = await f.read();
  await f.content.transitionIssue(f.project.id, issue.id, f.other, { revision: current.revision, transitionId: "verified_closed" });
  assert.equal((await f.read()).status, "closed");
  assert.equal(accepted.authorId, f.product.id);
  assert.equal(await f.database.client.developmentTask.count(), 0);
});
