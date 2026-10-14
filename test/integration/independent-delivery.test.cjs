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
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

test("independent delivery validates private task ownership, project and source, and reviews without issue workflow", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(p => p.scope === "project").map(p => p.id);
  const department = await database.client.department.create({ data: { name: "Delivery team", permissions } });
  const actor = await database.client.user.create({ data: { username: "dev", displayName: "Developer", passwordHash: "unused", departmentId: department.id } });
  const other = await database.client.user.create({ data: { username: "other", displayName: "Other developer", passwordHash: "unused", departmentId: department.id } });
  const project = await database.client.project.create({ data: { name: "Delivery", directoryName: "delivery", directoryKey: "delivery", remoteUrl: "https://example.test/delivery.git", ownerUserId: actor.id } });
  const foreign = await database.client.project.create({ data: { name: "Foreign", directoryName: "foreign", directoryKey: "foreign", remoteUrl: "https://example.test/foreign.git", ownerUserId: actor.id } });
  for (const user of [actor, other]) await database.client.projectMember.create({ data: { projectId: project.id, userId: user.id, permissions } });
  const projects = new ProjectServices(database), content = new ProjectContentServices(database, projects);
  const workbench = new WorkbenchServices(database, projects), development = new ProjectDevelopmentServices(database, projects, {});
  const attention = new AttentionServices(database, { projects, workspaces: {} });
  const createTask = overrides => database.client.developmentTask.create({ data: { projectId: project.id, executorId: actor.id, creatorId: actor.id, requestId: randomUUID(), workspaceId: randomUUID(), runKey: randomUUID(), status: "started", snapshot: { kind: "manual", title: "Independent refactor", issues: [], additions: [] }, ...overrides } });
  const task = await createTask({});
  assert.equal((await development.readSession(project.id, actor, { runKey: task.runKey })).task.id, task.id);
  await assert.rejects(development.readSession(project.id, other, { runKey: task.runKey }), { statusCode: 404 });
  const input = { reviewerId: other.id, taskId: task.id, title: "Refactor delivery", body: "Completed and checked", commit: "abc123" };
  for (const invalid of [{}, { projectId: foreign.id }, { executorId: other.id }, { status: "planned", runKey: null }, { status: "unknown" }, { status: "cancelled" }, { snapshot: { kind: "issues", title: "Issue task", issues: [], additions: [] } }]) {
    if (!Object.keys(invalid).length) { await assert.rejects(content.addDeliverable(project.id, actor, { ...input, taskId: undefined }), { statusCode: 400 }); continue; }
    const invalidTask = await createTask(invalid);
    await assert.rejects(content.addDeliverable(project.id, actor, { ...input, taskId: invalidTask.id }), { statusCode: 400 });
  }
  const issue = await content.createIssue(project.id, actor, { type: "requirement", title: "Unrelated issue" });
  await assert.rejects(content.addDeliverable(project.id, actor, { ...input, issueId: issue.id }), { statusCode: 400 });
  const delivery = await content.addDeliverable(project.id, actor, input);
  assert.equal(delivery.issueId, null);
  assert.equal((await content.readDeliverable(project.id, delivery.id, other)).issue, null);
  assert.equal((await workbench.list("deliveries", actor, { query: "Refactor" })).items[0].title, input.title);
  assert.equal((await workbench.activity(project.id, actor)).items.find(row => row.deliveryId === delivery.id).title, input.title);
  assert.ok((await attention.list(other)).items.some(row => row.deliveryId === delivery.id));
  const review = { revision: 1, status: "accepted", checkedItems: delivery.checklist.map((_, index) => index), reviewNote: "Verified" };
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, other, { ...review, transitionId: "complete", issueRevision: 1 }), { statusCode: 400 });
  const where = { projectId_userId: { projectId: project.id, userId: other.id } };
  await database.client.projectMember.update({ where, data: { permissions: permissions.filter(p => p !== "deliverable.review") } });
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, other, review), { statusCode: 403 });
  await database.client.projectMember.update({ where, data: { permissions: permissions.filter(p => p !== "issue.accept") } });
  assert.equal((await content.reviewDeliverable(project.id, delivery.id, other, review)).status, "accepted");
  assert.equal(await database.client.issueHistory.count({ where: { action: "delivery.reviewed" } }), 0);
  assert.equal(await database.client.auditEvent.count({ where: { event: "delivery.reviewed" } }), 1);
  await assert.rejects(content.reviewDeliverable(project.id, delivery.id, other, review), { statusCode: 409 });
  const returned = await content.addDeliverable(project.id, actor, input);
  assert.equal((await content.reviewDeliverable(project.id, returned.id, other, { revision: 1, status: "returned", checkedItems: [], reviewNote: "Add validation evidence" })).status, "returned");
  await database.client.project.update({ where: { id: project.id }, data: { status: "archived" } });
  await assert.rejects(content.addDeliverable(project.id, actor, input), { statusCode: 409 });
  assert.equal((await content.readDeliverable(project.id, delivery.id, actor)).permissions.includes("deliverable.review"), false);
});
