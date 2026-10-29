const test = require("node:test");
const assert = require("node:assert/strict");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
const { SystemWorkflowServices } = require("../../src/application/system-workflow-services.cjs");
const { projectPermissionCatalog } = require("../../src/domain/project-permissions.cjs");
const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
const { recommendedWorkflow } = require("../../src/domain/recommended-workflow.cjs");
const { randomUUID } = require("node:crypto");

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

test("system workflows publish one current version for issues across projects", async t => {
  const { database, actor, admin, projects, workflows, content } = await fixture(t);
  assert.equal(await database.client.systemWorkflow.count(), 2);
  assert.equal(await database.client.systemWorkflowVersion.count(), 2);
  const before = await Promise.all(projects.map(project => content.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "requirement", title: "发布前事项" })));
  assert.equal(before[0].workflowVersionId, before[1].workflowVersionId);
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  const definition = { nodes: [{ id: "triage", name: "分诊", kind: "initial", allowDevelopment: false }, { id: "resolved", name: "完成", kind: "completed", allowDevelopment: false }], transitions: [{ id: "resolve", name: "完成确认", from: "triage", to: "resolved", permission: "issue.accept", requiresReason: true }] };
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  const published = await workflows.readPublished(projects[0].id, "requirement", actor);
  assert.equal(Object.hasOwn(published.workflow, "draft"), false);
  assert.equal(Object.hasOwn(published.workflow, "revision"), false);
  assert.doesNotMatch(JSON.stringify(published), /triage/);
  await assert.rejects(workflows.saveWorkflow("requirement", admin, { revision: 1 }, true), { statusCode: 409 });
  await assert.rejects(workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true), /需要选择对应的新状态/);
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, mapping: { planned: "triage" } }, true));
  assert.equal(workflow.publishedVersion, 2);
  for (let index = 0; index < projects.length; index++) {
    const old = await content.readIssue(projects[index].id, before[index].id, actor);
    assert.equal(old.status, "triage");
    assert.equal(old.workflow.version, 2);
    assert.notEqual(old.workflowVersionId, before[index].workflowVersionId);
    assert.equal((await database.client.workAction.findFirst({ where: { issueId: old.id, status: "ready" } })).nodeId, "triage");
  }
  const after = await Promise.all(projects.map(project => content.createIssue(project.id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type: "requirement", title: "发布后事项" })));
  assert.equal(after[0].workflowVersionId, after[1].workflowVersionId);
  assert.notEqual(after[0].workflowVersionId, before[0].workflowVersionId);
  assert.equal(after[0].statusName, "分诊");
  await assert.rejects(content.transitionIssue(projects[0].id, after[0].id, actor, { revision: 1, transitionId: "resolve" }), /原因/);
  assert.equal((await content.transitionIssue(projects[0].id, after[0].id, actor, { revision: 1, transitionId: "resolve", reason: "检查通过" })).status, "resolved");
});

test("publishing the global workflow keeps an existing delivery actionable", async t => {
  const { database, actor, admin, projects, workflows, content } = await fixture(t);
  const project = projects[0], definition = recommendedWorkflow("requirement");
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true));
  const issue = await content.createIssue(project.id, actor, { type: "requirement", title: "送验中的事项", businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id });
  const development = new ProjectDevelopmentServices(database, content.projects);
  const { tasks: [task] } = await development.create(project.id, actor, { requestId: randomUUID(), issueIds: [issue.id] });
  const ready = await content.readIssue(project.id, issue.id, actor);
  const delivery = await content.addDeliverable(project.id, actor, { requestId: randomUUID(), issueId: issue.id, issueRevision: ready.revision, taskId: task.id, reviewerId: actor.id, body: "准备好的成果" });
  const pending = await content.readIssue(project.id, issue.id, actor);
  const actionId = pending.processing.id;
  definition.nodes.find(node => node.id === pending.status).name = "等待团队验证";
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true);
  const current = await content.readIssue(project.id, issue.id, actor);
  assert.equal(current.statusName, "等待团队验证");
  assert.equal(current.processing.id, actionId);
  await content.reviewDeliverable(project.id, delivery.id, actor, { revision: delivery.revision, status: "accepted", checkedItems: delivery.checklist.map((_, index) => index), reviewNote: "已验证" });
  assert.equal((await content.readIssue(project.id, issue.id, actor)).status, "implemented");
});

test("verification follows the configured checklist and return reason rules", async t => {
  const { database, actor, admin, projects, workflows, content } = await fixture(t);
  const project = projects[0], definition = recommendedWorkflow("requirement");
  for (const edge of definition.transitions) {
    if (edge.trigger === "verification.accepted") edge.requireChecklist = false;
    if (edge.trigger === "verification.returned") edge.requiresReason = false;
  }
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true);
  const issue = await content.createIssue(project.id, actor, { type: "requirement", title: "自定义验收", acceptanceCriteria: ["确认结果"], businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id });
  const development = new ProjectDevelopmentServices(database, content.projects);
  const { tasks: [task] } = await development.create(project.id, actor, { requestId: randomUUID(), issueIds: [issue.id] });
  let current = await content.readIssue(project.id, issue.id, actor);
  let delivery = await content.addDeliverable(project.id, actor, { requestId: randomUUID(), issueId: issue.id, issueRevision: current.revision, taskId: task.id, reviewerId: actor.id, body: "完成的成果" });
  delivery = await content.reviewDeliverable(project.id, delivery.id, actor, { revision: delivery.revision, status: "returned", checkedItems: [], reviewNote: "" });
  current = await content.readIssue(project.id, issue.id, actor);
  delivery = await content.addDeliverable(project.id, actor, { requestId: randomUUID(), issueId: issue.id, issueRevision: current.revision, taskId: task.id, reviewerId: actor.id, body: "补充后的成果", supersedesId: delivery.id, previousRevision: delivery.revision });
  await content.reviewDeliverable(project.id, delivery.id, actor, { revision: delivery.revision, status: "accepted", checkedItems: [], reviewNote: "" });
  assert.equal((await content.readIssue(project.id, issue.id, actor)).status, "implemented");
});

test("existing issues use the latest published workflow fields", async t => {
  const { actor, admin, projects, workflows, content } = await fixture(t);
  for (const [type, field] of [["requirement", "reproductionSteps"], ["bug", "acceptanceCriteria"]]) {
    const definition = { nodes: [{ id: "start", name: "开始", kind: "initial", allowDevelopment: false }, { id: "done", name: "完成", kind: "completed", allowDevelopment: false }],
      transitions: [{ id: "finish", from: "start", to: "done", name: "完成", permission: "issue.transition", requiresReason: false, requiredFields: [field] }] };
    let { workflow } = await workflows.readWorkflow(type, admin);
    ({ workflow } = await workflows.saveWorkflow(type, admin, { revision: workflow.revision, definition }));
    ({ workflow } = await workflows.saveWorkflow(type, admin, { revision: workflow.revision }, true));
    let issue = await content.createIssue(projects[0].id, actor, { ...{ businessOwnerId: actor.id, qaOwnerId: actor.id, acceptanceOwnerId: actor.id }, type, title: "流程要求的文本资料" });
    definition.transitions[0].requiredFields = [];
    ({ workflow } = await workflows.saveWorkflow(type, admin, { revision: workflow.revision, definition }));
    await workflows.saveWorkflow(type, admin, { revision: workflow.revision }, true);
    issue = await content.readIssue(projects[0].id, issue.id, actor);
    assert.deepEqual(issue.workflow.definition.transitions[0].requiredFields, []);
    assert.equal((await content.transitionIssue(projects[0].id, issue.id, actor, { revision: issue.revision, transitionId: "finish" })).status, "done");
  }
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

test("publishing rejects a returned delivery with no route to resubmission", async t => {
  const { admin, workflows } = await fixture(t);
  let { workflow } = await workflows.readWorkflow("requirement", admin);
  const definition = structuredClone(workflow.draft);
  definition.transitions = definition.transitions.filter(edge => !(edge.from === "rework" && ["development.started", "delivery.submitted"].includes(edge.trigger)));
  ({ workflow } = await workflows.saveWorkflow("requirement", admin, { revision: workflow.revision, definition }));
  await assert.rejects(workflows.saveWorkflow("requirement", admin, { revision: workflow.revision }, true), /退回后.*重新送验/);
  assert.equal((await workflows.readWorkflow("requirement", admin)).workflow.publishedVersion, 1);
});
