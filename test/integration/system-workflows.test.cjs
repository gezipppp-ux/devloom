const test = require("node:test");
const assert = require("node:assert/strict");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { SystemWorkflowServices } = require("../../src/application/system-workflow-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");

async function fixture(t) {
  const database = await initializeTestDatabase(t, temporary(t));
  const permissions = projectPermissionCatalog.filter(entry => entry.scope === "project").map(entry => entry.id);
  const department = await database.client.department.create({ data: { name: "系统流程测试", permissions } });
  const actor = await database.client.user.create({ data: { username: "workflow-member", displayName: "项目成员", passwordHash: "unused", departmentId: department.id } });
  const admin = await database.client.user.create({ data: { username: "workflow-admin", displayName: "系统管理员", passwordHash: "unused", role: "admin" } });
  const projects = [];
  for (const name of ["甲项目", "乙项目"]) {
    const project = await database.client.project.create({ data: { name, directoryName: name, directoryKey: name.toLowerCase(), ownerUserId: actor.id, remoteUrl: "https://example.test/repo.git" } });
    await database.client.projectMember.create({ data: { projectId: project.id, userId: actor.id, permissions } });
    projects.push(project);
  }
  const accounts = new AccountServices(database);
  t.after(() => accounts.close());
  const projectServices = new ProjectServices(database);
  return { database, actor, admin, projects, workflows: new SystemWorkflowServices(database, accounts, projectServices), content: new ProjectContentServices(database, projectServices) };
}

test("system workflows are migration-seeded, shared across projects and keep immutable issue bindings", async t => {
  const { database, actor, admin, projects, workflows, content } = await fixture(t);
  assert.equal(await database.client.systemWorkflow.count(), 2);
  assert.equal(await database.client.systemWorkflowVersion.count(), 2);
  const before = await Promise.all(projects.map(project => content.createIssue(project.id, actor, { type: "requirement", title: "发布前事项" })));
  assert.equal(before[0].workflowVersionId, before[1].workflowVersionId);
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  const definition = { nodes: [{ id: "triage", name: "分诊", kind: "initial", allowDevelopment: false }, { id: "resolved", name: "完成", kind: "completed", allowDevelopment: false }], transitions: [{ id: "resolve", name: "完成确认", from: "triage", to: "resolved", permission: "issue.accept", requiresReason: true }] };
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  const published = await workflows.readPublished(projects[0].id, "requirement", actor);
  assert.equal(Object.hasOwn(published.workflow, "draft"), false);
  assert.equal(Object.hasOwn(published.workflow, "revision"), false);
  assert.doesNotMatch(JSON.stringify(published), /triage/);
  await assert.rejects(workflows.saveWorkflow("requirement", admin, { revision: 1 }, true), { statusCode: 409 });
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true));
  assert.equal(workflow.publishedVersion, 2);
  for (let index = 0; index < projects.length; index++) {
    const old = await content.readIssue(projects[index].id, before[index].id, actor);
    assert.equal(old.status, "planned");
    assert.equal(old.workflow.version, 1);
    assert.equal(old.workflowVersionId, before[index].workflowVersionId);
  }
  const after = await Promise.all(projects.map(project => content.createIssue(project.id, actor, { type: "requirement", title: "发布后事项" })));
  assert.equal(after[0].workflowVersionId, after[1].workflowVersionId);
  assert.notEqual(after[0].workflowVersionId, before[0].workflowVersionId);
  assert.equal(after[0].statusName, "分诊");
  await assert.rejects(content.transitionIssue(projects[0].id, after[0].id, actor, { revision: 1, transitionId: "resolve" }), /原因/);
  assert.equal((await content.transitionIssue(projects[0].id, after[0].id, actor, { revision: 1, transitionId: "resolve", reason: "检查通过" })).status, "resolved");
});

test("system workflow management rejects project owners and rechecks persisted administrator role", async t => {
  const { database, actor, admin, projects, workflows } = await fixture(t);
  let { workflow } = await workflows.readWorkflow("bug", admin);
  for (const action of [
    () => workflows.readWorkflow("bug", actor),
    () => workflows.saveWorkflow("bug", actor, { revision: workflow.revision, definition: workflow.draft }),
    () => workflows.saveWorkflow("bug", actor, { revision: workflow.revision }, true),
  ]) await assert.rejects(action(), { statusCode: 403 });
  const results = await Promise.allSettled(["甲草稿", "乙草稿"].map(name => {
    const definition = structuredClone(workflow.draft);
    definition.nodes[0].name = name;
    return workflows.saveWorkflow("bug", admin, { revision: workflow.revision, definition });
  }));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.statusCode, 409);
  ({ workflow } = await workflows.readWorkflow("bug", admin));
  await database.client.user.update({ where: { id: admin.id }, data: { role: "member" } });
  await assert.rejects(workflows.saveWorkflow("bug", admin, { revision: workflow.revision }, true), { statusCode: 403 });
  await database.client.projectMember.update({ where: { projectId_userId: { projectId: projects[0].id, userId: actor.id } }, data: { status: "inactive" } });
  await assert.rejects(workflows.readPublished(projects[0].id, "bug", actor), { statusCode: 404 });
  assert.equal((await workflows.readPublished(projects[1].id, "bug", actor)).workflow.publishedVersion, 1);
});
