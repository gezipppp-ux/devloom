const { test } = require("node:test");
const assert = require("node:assert/strict");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { WorkbenchServices } = require("../../src/application/workbench-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

test("project visits are personal, ordered, bounded and filtered again after authorization changes", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const actor = await database.client.user.create({ data: { username: "visitor", displayName: "Visitor", role: "admin", passwordHash: "unused" } });
  const other = await database.client.user.create({ data: { username: "other", displayName: "Other", role: "admin", passwordHash: "unused" } });
  const projects = new ProjectServices(database), workbench = new WorkbenchServices(database, projects);
  const ids = [];
  for (let index = 0; index < 4; index++) {
    const project = await database.client.project.create({ data: { name: "Project " + index, directoryName: "project-" + index, directoryKey: "project-" + index, remoteUrl: "https://example.test/repo.git", ownerUserId: actor.id } });
    ids.push(project.id);
    await projects.recordVisit(project.id, actor);
    await database.client.userProjectVisit.update({ where: { userId_projectId: { userId: actor.id, projectId: project.id } }, data: { lastVisitedAt: new Date(2026, 0, index + 1) } });
  }
  assert.deepEqual((await workbench.recentProjects(actor)).projects.map(p => p.id), ids.slice(1).reverse());
  assert.equal((await workbench.recentProjects(other)).projects.length, 0);
  await projects.recordVisit(ids[0], actor);
  assert.equal((await workbench.recentProjects(actor)).projects[0].id, ids[0]);
  assert.equal(await database.client.userProjectVisit.count({ where: { userId: actor.id } }), 4, "repeat visit updates one record");
  await database.client.user.update({ where: { id: actor.id }, data: { role: "member" } });
  assert.equal((await workbench.recentProjects(actor)).projects.length, 0, "revoked projects disappear");
  await assert.rejects(projects.recordVisit(ids[0], actor), { statusCode: 404 });
  await database.client.user.update({ where: { id: actor.id }, data: { role: "admin" } });
  const query = workbench.store.recentProjects.bind(workbench.store);
  workbench.store.recentProjects = async (...args) => { const rows = await query(...args); await database.client.user.update({ where: { id: actor.id }, data: { role: "member" } }); return rows; };
  await assert.rejects(workbench.recentProjects(actor), { statusCode: 404 }, "late revocation cannot expose recent records");
});

test("project activity exposes only authorized public actions, newest ten, without snapshots or private identifiers", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(p => p.scope === "project").map(p => p.id);
  const department = await database.client.department.create({ data: { name: "Activity", permissions } });
  const actor = await database.client.user.create({ data: { username: "activity", displayName: "Activity author", departmentId: department.id, passwordHash: "unused" } });
  const outsider = await database.client.user.create({ data: { username: "outsider", displayName: "Outsider", passwordHash: "unused" } });
  const project = await database.client.project.create({ data: { name: "Activity project", directoryName: "activity", directoryKey: "activity", remoteUrl: "https://example.test/repo.git", ownerUserId: actor.id } });
  const where = { projectId_userId: { projectId: project.id, userId: actor.id } };
  await database.client.projectMember.create({ data: { projectId: project.id, userId: actor.id, permissions } });
  const projects = new ProjectServices(database), content = new ProjectContentServices(database, projects), workbench = new WorkbenchServices(database, projects);
  const issue = await content.createIssue(project.id, actor, { type: "requirement", title: "Public title" });
  for (let index = 0; index < 12; index++) await content.store.issueHistory(project.id, issue.id, actor.id, "updated", { privateSession: "private-secret", index });
  const delivery = await content.addDeliverable(project.id, actor, { issueId: issue.id, body: "Public delivery" });
  await content.reviewDeliverable(project.id, delivery.id, actor, { revision: 1, status: "returned", reviewNote: "More detail needed", checkedItems: [] });
  const result = await workbench.activity(project.id, actor);
  assert.equal(result.items.length, 10);
  assert.ok(result.items.some(item => item.action === "delivery.published" && item.deliveryId === delivery.id));
  assert.ok(result.items.some(item => item.action === "delivery.reviewed" && item.deliveryId === delivery.id));
  assert.ok(result.items.every((item, index) => !index || result.items[index - 1].createdAt >= item.createdAt));
  assert.ok(!JSON.stringify(result).includes("private-secret"));
  assert.ok(result.items.every(item => !Object.hasOwn(item, "data") && !Object.hasOwn(item, "actorId")));
  await assert.rejects(workbench.activity(project.id, outsider), { statusCode: 404 });
  await database.client.projectMember.update({ where, data: { permissions: permissions.filter(p => p !== "collaboration.view") } });
  assert.ok((await workbench.activity(project.id, actor)).items.every(item => !item.action.startsWith("delivery.")));
  const query = workbench.store.activity.bind(workbench.store);
  workbench.store.activity = async (...args) => { const rows = await query(...args); await database.client.projectMember.update({ where, data: { permissions: ["project.view"] } }); return rows; };
  await assert.rejects(workbench.activity(project.id, actor), { statusCode: 403 });
});
