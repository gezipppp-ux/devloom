const { installReviewWorkflow } = require("../support/workflow-fixture.cjs");
const { defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

async function fixture(t, { definition, count = 1 } = {}) {
  const database = await initializeTestDatabase(t, temporary(t));
  if (definition) await installReviewWorkflow(database, definition);
  const permissions = projectPermissionCatalog.filter(p => p.scope === "project").map(p => p.id);
  const department = await database.client.department.create({ data: { name: "Team", permissions } });
  const users = {};
  for (const name of ["owner", "dev", "qa", "other"]) users[name] = await database.client.user.create({ data: { username: name, displayName: name, passwordHash: "unused", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "Handoffs", directoryName: "handoffs", directoryKey: "handoffs", remoteUrl: "https://example.test/handoffs.git", ownerUserId: users.owner.id } });
  for (const user of Object.values(users)) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions: user.id === users.dev.id ? permissions.filter(p => !["issue.assign", "issue.accept", "deliverable.review"].includes(p)) : permissions } });
  const projects = new ProjectServices(database), content = new ProjectContentServices(database, projects);
  const development = new ProjectDevelopmentServices(database, projects, { get: () => assert.fail("No real Agent") });
  const workspace = await database.client.workspace.create({ data: { ownerUserId: users.dev.id, name: "Fake execution" } });
  const issue = await content.createIssue(project.id, users.owner, { type: "requirement", title: "Handoff", qaOwnerId: users.qa.id, acceptanceOwnerId: users.owner.id });
  const issues = [issue];
  for (let i = 1; i < count; i++) issues.push(await content.createIssue(project.id, users.owner, { type: "requirement", title: "Scope " + i, qaOwnerId: users.qa.id }));
  const { tasks } = await development.create(project.id, users.dev, { requestId: randomUUID(), issueIds: issues.map(issue => issue.id) });
  const task = tasks.length === 1 ? tasks[0] : (await development.merge(project.id, users.dev, { requestId: randomUUID(), title: "Combined", tasks: tasks.map(({ id, revision }) => ({ id, revision })) })).task;
  const read = () => content.readIssue(project.id, issue.id, users.dev);
  const run = async (turnId = randomUUID(), afterPrepare) => {
    await database.client.developmentTask.update({ where: { id: task.id }, data: { status: "started", workspaceId: workspace.id, runKey: task.id } });
    await development.workflowExecution.prepare(await development.store.task(project.id, task.id), users.dev);
    await afterPrepare?.();
    const root = path.join(database.dataRoot, "workspaces", workspace.id, "runs", task.id);
    await database.writeDocument(path.join(root, "run.json"), { execution: { status: "completed" } });
    await database.appendLog(path.join(root, "agent-events.jsonl"), JSON.stringify({ type: "turn-started", turn: { id: turnId } }) + "\n");
    await development.workflowExecution.event(workspace.id, task.id);
  };
  const submit = (extra = {}) => content.addDeliverable(project.id, users.dev, { requestId: randomUUID(), issueId: issue.id, taskId: task.id, reviewerId: users.qa.id, title: "Delivery", body: "Evidence", ...extra });
  return { database, project, projects, content, development, issue, issues, task, read, run, submit, ...users };
}

test("claim, real start, submission and acceptance hand off atomically without owner intervention", async t => {
  const f = await fixture(t);
  assert.equal((await f.read()).status, "ready");
  assert.equal((await f.read()).processing.handlerId, f.dev.id);
  assert.equal((await f.read()).businessOwnerId, f.owner.id);
  await f.run("first-turn");
  assert.equal((await f.read()).status, "developing");
  const delivery = await f.submit();
  assert.equal((await f.read()).status, "pending_verification");
  assert.equal((await f.read()).processing.handlerId, f.qa.id);
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "started");
  const started = await f.content.beginDelivery(f.project.id, delivery.id, f.qa, { revision: delivery.revision });
  assert.equal((await f.read()).status, "verifying");
  await assert.rejects(f.content.reviewDeliverable(f.project.id, delivery.id, f.other, { revision: started.revision, status: "accepted", checkedItems: started.checklist.map((_, i) => i) }), { statusCode: 403 });
  await f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: started.revision, status: "accepted", checkedItems: started.checklist.map((_, i) => i) });
  assert.equal((await f.read()).status, "implemented");
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "completed");
});

test("returned work retains the same task and creates a new verification round", async t => {
  const f = await fixture(t); await f.run();
  let delivery = await f.submit();
  delivery = await f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: delivery.revision, status: "returned", checkedItems: [], reviewNote: "Fix the edge case" });
  const current = (await f.development.read(f.project.id, f.task.id, f.dev)).task;
  assert.equal(current.canRework, false, "a retained worktree must continue its original task");
  await assert.rejects(f.development.rework(f.project.id, f.task.id, f.dev, { requestId: randomUUID(), revision: current.revision, deliveries: [{ id: delivery.id, revision: delivery.revision }] }), { statusCode: 409 });
  assert.equal((await f.read()).status, "rework");
  assert.equal((await f.read()).processing.handlerId, f.dev.id);
  await f.run();
  assert.equal((await f.read()).status, "developing");
  const next = await f.submit({ supersedesId: delivery.id, previousRevision: delivery.revision });
  assert.equal(next.taskId, f.task.id);
  assert.equal(next.supersedesId, delivery.id);
  assert.equal((await f.read()).status, "pending_verification");
  await assert.rejects(f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: delivery.revision, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i) }), { statusCode: 409 });
});

test("concurrent cleaned-worktree rework transfers claims once and preserves the original request", async t => {
  const f = await fixture(t); await f.run();
  const delivery = await f.submit();
  await f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: delivery.revision, status: "returned", checkedItems: [], reviewNote: "Rework" });
  const task = await f.development.store.task(f.project.id, f.task.id);
  const root = path.join(f.database.dataRoot, "workspaces", task.workspaceId, "runs", task.runKey);
  await f.database.writeDocument(path.join(root, "worktree-deletion.json"), { status: "deleted", worktreeRemoved: true });
  const presented = (await f.development.read(f.project.id, task.id, f.dev)).task;
  const input = { requestId: randomUUID(), revision: presented.revision, deliveries: presented.reworkDeliveries };
  const outcomes = await Promise.allSettled([f.development.rework(f.project.id, task.id, f.dev, input), f.development.rework(f.project.id, task.id, f.dev, input)]);
  assert.ok(outcomes.some(result => result.status === "fulfilled"));
  for (const result of outcomes.filter(result => result.status === "rejected")) assert.equal(result.reason.statusCode, 409);
  const replacement = (await f.development.rework(f.project.id, task.id, f.dev, input)).task;
  assert.equal(await f.database.client.developmentTask.count(), 2);
  assert.equal((await f.read()).development.taskId, replacement.id);
  assert.equal((await f.read()).processing.handlerId, f.dev.id);
  await assert.rejects(f.development.rework(f.project.id, task.id, f.dev, { ...input, revision: input.revision + 1 }), { statusCode: 409 });
  const original = await f.development.store.task(f.project.id, task.id);
  assert.equal(original.workspaceId, task.workspaceId); assert.equal(original.runKey, task.runKey);
  assert.equal(original.status, "cancelled");
});

test("failed handoff rolls back delivery; another qualified reviewer becomes the actual handler", async t => {
  const f = await fixture(t); await f.run();
  await assert.rejects(f.submit({ reviewerId: f.dev.id }), { statusCode: 403 });
  assert.equal(await f.database.client.projectDeliverable.count(), 0);
  assert.equal((await f.read()).status, "developing");
  const requestId = randomUUID(), input = { requestId, reviewerId: f.other.id };
  const delivery = await f.submit(input);
  assert.equal((await f.read()).processing.handlerId, f.other.id);
  assert.equal((await f.submit(input)).id, delivery.id);
  await f.content.reviewDeliverable(f.project.id, delivery.id, f.other, { revision: delivery.revision, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i) });
  assert.equal((await f.read()).status, "implemented");
});

test("renamed custom states and extra business approval remain configurable", async t => {
  const definition = defaultWorkflow("requirement");
  const accepted = definition.nodes.find(node => node.id === "implemented");
  Object.assign(accepted, { kind: "normal", handler: "acceptanceOwner", name: "业务确认" });
  definition.nodes.push({ ...accepted, id: "signed", kind: "completed", name: "已签收" });
  definition.transitions.push({ id: "sign", from: "implemented", to: "signed", name: "签收", trigger: "manual", actor: "handler", assignment: "role", permission: "issue.accept", requiresReason: false, requireAcceptedDelivery: true });
  for (const node of definition.nodes) node.id = "custom_" + node.id;
  for (const edge of definition.transitions) { edge.from = "custom_" + edge.from; edge.to = "custom_" + edge.to; }
  const f = await fixture(t, { definition });
  await f.run();
  assert.equal((await f.read()).status, "custom_developing");
  const delivery = await f.submit();
  await f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: 1, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i) });
  const issue = await f.read();
  assert.equal(issue.status, "custom_implemented");
  assert.equal(issue.processing.handlerId, f.owner.id);
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "started");
  await f.content.transitionIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, transitionId: "sign" });
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "completed");
});

test("merged tasks submit only covered scopes and atomically submit multiple remaining issues", async t => {
  const f = await fixture(t, { count: 3 }); await f.run();
  const first = await f.submit();
  for (const issue of f.issues.slice(1)) assert.equal((await f.content.readIssue(f.project.id, issue.id, f.dev)).status, "developing");
  const items = f.issues.slice(1).map(issue => ({ requestId: randomUUID(), issueId: issue.id, taskId: f.task.id, reviewerId: f.qa.id, title: issue.title, body: "Batch evidence" }));
  await assert.rejects(f.content.addDeliverables(f.project.id, f.dev, { items: [items[0], { ...items[1], reviewerId: f.dev.id }] }), { statusCode: 403 });
  assert.equal(await f.database.client.projectDeliverable.count(), 1, "invalid batch rolls back every handoff");
  const batch = await f.content.addDeliverables(f.project.id, f.dev, { items });
  for (const delivery of [first, ...batch.items.slice(0, 1)]) await f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, { revision: 1, status: "accepted", checkedItems: delivery.checklist.map((_, i) => i) });
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "started");
  const last = batch.items[1];
  await f.content.reviewDeliverable(f.project.id, last.id, f.qa, { revision: 1, status: "accepted", checkedItems: last.checklist.map((_, i) => i) });
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "completed");
});

test("stale real-start events stay blocked until explicit retry and duplicate recovery is idempotent", async t => {
  const f = await fixture(t);
  await f.run("durable-turn", async () => {
    const issue = await f.read();
    await f.content.updateIssue(f.project.id, issue.id, f.owner, { revision: issue.revision, description: "Changed before real start" });
  });
  assert.equal((await f.read()).status, "ready");
  let task = (await f.development.read(f.project.id, f.task.id, f.dev)).task;
  assert.equal(task.workflowErrors.length, 1);
  await f.development.workflowExecution.recoverTask(await f.development.store.task(f.project.id, f.task.id), true);
  assert.equal((await f.read()).status, "developing");
  const revision = (await f.read()).revision;
  await Promise.all([f.development.workflowExecution.event(task.workspaceId, task.runKey), f.development.workflowExecution.event(task.workspaceId, task.runKey)]);
  assert.equal((await f.read()).revision, revision);
  task = (await f.development.read(f.project.id, f.task.id, f.dev)).task;
  assert.equal(task.workflowErrors.length, 0);
  assert.equal(await f.database.client.workflowExecutionEvent.count(), 1);
});

test("simultaneous submissions cannot create two current delivery rounds", async t => {
  const f = await fixture(t); await f.run();
  const outcomes = await Promise.allSettled([f.submit(), f.submit()]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(item => item.status === "rejected").reason.statusCode, 409);
  assert.equal(await f.database.client.projectDeliverable.count(), 1);
  assert.equal((await f.read()).status, "pending_verification");
});

test("cancelled development can be explicitly claimed again without reviving its old task", async t => {
  const f = await fixture(t); await f.run();
  f.development.workspaces = { get: async () => ({ sessions: { exclusive: (_key, operation) => operation(), git: { activeReason: () => null, assertIdle: async () => {} }, store: { read: async () => ({}) } } }) };
  const current = (await f.development.read(f.project.id, f.task.id, f.dev)).task;
  await f.development.finish(f.project.id, f.task.id, f.dev, { revision: current.revision }, "cancelled");
  const next = (await f.development.create(f.project.id, f.dev, { requestId: randomUUID(), issueIds: [f.issue.id] })).tasks[0];
  assert.notEqual(next.id, f.task.id);
  assert.equal(next.status, "planned");
  assert.equal((await f.read()).processing.handlerId, f.dev.id);
  assert.equal((await f.development.read(f.project.id, f.task.id, f.dev)).task.status, "cancelled");
});

test("editing planned scope hands newly added issues to the executor and releases removed claims", async t => {
  const f = await fixture(t);
  const issue = await f.content.createIssue(f.project.id, f.owner, { type: "requirement", title: "Replacement scope", qaOwnerId: f.qa.id });
  const result = await f.development.update(f.project.id, f.task.id, f.dev, { revision: f.task.revision, issueIds: [issue.id] });
  const updated = await f.content.readIssue(f.project.id, issue.id, f.dev);
  assert.equal(updated.status, "ready");
  assert.equal(updated.processing.handlerId, f.dev.id);
  assert.equal(updated.development.taskId, result.task.id);
  assert.equal((await f.read()).development, null);
  assert.equal((await f.read()).assignmentAllowed, true);
});

test("reassigning an ongoing verification keeps its stage and hands authority to the new reviewer", async t => {
  const f = await fixture(t); await f.run();
  let delivery = await f.submit();
  delivery = await f.content.beginDelivery(f.project.id, delivery.id, f.qa, { revision: delivery.revision });
  const reassigned = await f.content.reassignDelivery(f.project.id, delivery.id, f.owner, { revision: delivery.revision, reviewerId: f.other.id });
  assert.equal(reassigned.verificationStartedAt, delivery.verificationStartedAt);
  assert.equal((await f.read()).status, "verifying");
  assert.equal((await f.read()).processing.handlerId, f.other.id);
  const input = { revision: reassigned.revision, status: "accepted", checkedItems: reassigned.checklist.map((_, i) => i) };
  await assert.rejects(f.content.reviewDeliverable(f.project.id, delivery.id, f.qa, input), { statusCode: 403 });
  await f.content.reviewDeliverable(f.project.id, delivery.id, f.other, input);
  assert.equal((await f.read()).status, "implemented");
});
